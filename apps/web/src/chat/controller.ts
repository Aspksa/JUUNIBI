import { recentContext } from "./context";
import { Store } from "@juunibi/core";
import { api } from "../api";
import { app, refreshMemory } from "../state";
import { DEFAULT_TITLE, titleFrom, uid, versionOf, type Chats, type ChatMsg, type Step, type Version } from "./chats";
import { withFiles, type Attachment } from "./helpers";
import { streamChat } from "./stream";

/** A message written while JUUNIBI was still answering: it goes out as soon as the answer is done. */
export interface Queued { id: string; convId: string; text: string; files: Attachment[] }
export interface CtlState { busyId: string | null; unread: number; queue: Queued[] }
/** What «Продолжить» asks; the answer is added to the same message. */
export const CONTINUE_PROMPT = "Продолжи свой предыдущий ответ ровно с того места, где он оборвался. Не повторяй уже написанное и не начинай заново.";
const MAX_VERSIONS = 6;
interface GenOpts { into?: ChatMsg; prior?: Version[]; question?: string }

/** Runs generations independently of the chat window, so a reply keeps streaming while the window is closed. */
export class ChatController {
  readonly store = new Store<CtlState>({ busyId: null, unread: 0, queue: [] });
  private abort: AbortController | null = null;

  constructor(private readonly chats: Chats) {}

  get busy(): boolean { return this.store.get().busyId !== null; }

  /** Conversation history the model should see: finished, non-empty turns only. */
  private historyBefore(convId: string, msgId?: string): { role: "user" | "assistant"; content: string }[] {
    const c = this.chats.get(convId);
    if (!c) return [];
    const upTo = msgId ? c.messages.findIndex((m) => m.id === msgId) : c.messages.length;
    return recentContext(c.messages.slice(0, upTo < 0 ? c.messages.length : upTo)
      .filter((m): m is ChatMsg & { role: "user" | "assistant" } => m.role !== "note" && !!m.content.trim() && !m.error)
      .map((m) => ({ role: m.role, content: m.role === "user" ? withFiles(m.content, m.files) : m.content })));
  }

  async send(convId: string, text: string, files: Attachment[] = []): Promise<void> {
    const content = text.trim();
    if (!content && !files.length) return;
    if (this.busy) { this.enqueue(convId, content, files); return; }
    const conv = this.chats.get(convId);
    if (!conv) return;
    const history = this.historyBefore(convId);
    this.chats.append(convId, { role: "user", content, ...(files.length ? { files } : {}) });
    if (conv.title === DEFAULT_TITLE && !conv.messages.some((m) => m.role === "user")) this.chats.rename(convId, titleFrom(content || files[0]?.name || ""), true);
    await this.generate(convId, withFiles(content, files), history, { question: content || files.map((f) => f.name).join(", ") });
  }

  /** Waits in line while another answer is written (in this chat or any other). */
  enqueue(convId: string, text: string, files: Attachment[] = []) {
    this.store.set((s) => ({ queue: [...s.queue, { id: uid(), convId, text, files }].slice(-10) }));
  }
  unqueue(id: string) { this.store.set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })); }
  private runQueue() {
    const next = this.store.get().queue[0];
    if (!next || this.busy) return;
    this.unqueue(next.id);
    if (!this.chats.get(next.convId)) { this.runQueue(); return; }
    void this.send(next.convId, next.text, next.files);
  }

  /** A local note in the thread (command results). Never sent to the model. */
  note(convId: string, text: string) { this.chats.append(convId, { role: "note", content: text }); }

  async remember(convId: string, text: string): Promise<boolean> {
    const r = await api.addMemory(text.trim().slice(0, 2000));
    this.note(convId, r.ok ? `Запомнено: «${r.value.text}»` : `Не удалось запомнить: ${r.error.message}`);
    if (r.ok) await refreshMemory();
    return r.ok;
  }

  /** Re-asks the last user message, replacing the last assistant reply. */
  async regenerate(convId: string): Promise<void> {
    if (this.busy) return;
    const c = this.chats.get(convId);
    if (!c) return;
    const lastUser = [...c.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const idx = c.messages.findIndex((m) => m.id === lastUser.id);
    const history = this.historyBefore(convId, lastUser.id);
    // drop everything after the user message, keep the user message itself; the old answer stays as a version
    const after = c.messages[idx + 1];
    let prior: Version[] = [];
    if (after?.role === "assistant" && (after.content || after.error)) {
      prior = after.versions ? after.versions.map((v, i) => (i === after.vi ? versionOf(after) : v)) : [versionOf(after)];
    }
    if (after) this.chats.truncateFrom(convId, after.id);
    await this.generate(convId, withFiles(lastUser.content, lastUser.files), history, { prior: prior.slice(-(MAX_VERSIONS - 1)), question: lastUser.content });
  }

  /** ‹ 1/3 ›: shows another version of an answer (the current one is kept as it is now, with its rating). */
  pickVersion(convId: string, msgId: string, k: number) {
    const m = this.chats.get(convId)?.messages.find((x) => x.id === msgId);
    if (!m?.versions || this.store.get().busyId === convId) return;
    const vs = m.versions.map((v, i) => (i === m.vi ? versionOf(m) : v));
    const t = vs[k];
    if (!t) return;
    this.chats.rewrite(convId, msgId, (x) => {
      const { turnId: _t, rating: _r, tools: _to, steps: _s, memoryUsed: _m, error: _e, stopped: _st, followUps: _f, ...rest } = x;
      return { ...rest, ...t, versions: vs, vi: k };
    });
  }

  /** «Продолжить»: an answer that was cut off or stopped goes on in the same message. */
  async continueReply(convId: string): Promise<void> {
    if (this.busy) return;
    const c = this.chats.get(convId);
    const m = c?.messages[c.messages.length - 1];
    if (!c || !m || m.role !== "assistant" || !m.content.trim()) return;
    const history = [...this.historyBefore(convId, m.id), { role: "assistant" as const, content: m.content }];
    await this.generate(convId, CONTINUE_PROMPT, history, { into: m });
  }

  /** Replaces a user message with edited text and regenerates from there. */
  async edit(convId: string, msgId: string, newText: string): Promise<void> {
    const content = newText.trim();
    if (this.busy) return;
    const original = this.chats.get(convId)?.messages.find((m) => m.id === msgId);
    const files = original?.files ?? [];
    if (!content && !files.length) return;
    const history = this.historyBefore(convId, msgId);
    this.chats.truncateFrom(convId, msgId);
    this.chats.append(convId, { role: "user", content, ...(files.length ? { files } : {}) });
    await this.generate(convId, withFiles(content, files), history, { question: content });
  }

  stop() { this.abort?.abort(); }

  private async generate(convId: string, userText: string, history: { role: "user" | "assistant"; content: string }[], o: GenOpts = {}): Promise<void> {
    const reply = o.into ?? this.chats.append(convId, { role: "assistant", content: "" });
    // a continued answer keeps what it had; the new text is added after it
    const base = o.into ? o.into.content : "";
    if (o.into) this.chats.rewrite(convId, reply.id, (x) => { const { error: _e, stopped: _s, followUps: _f, ...rest } = x; return rest; });
    const ctl = new AbortController();
    this.abort = ctl;
    this.store.set({ busyId: convId });

    // The character "scene" is optional flavour; it must never delay or break the real answer.
    if (app.get().showScenes && !o.into) {
      void api.nextScene().then((r) => {
        if (r.ok) this.chats.patch(convId, reply.id, { scene: { action: r.value.action.text, ...(r.value.phrase ? { phrase: r.value.phrase.text } : {}) } });
      }).catch(() => { /* Character scene is optional: never interrupt the answer. */ });
    }

    let text = "";
    let lastPaint = 0;
    const paint = (force = false) => { const now = Date.now(); if (force || now - lastPaint >= 50) { lastPaint = now; this.chats.patch(convId, reply.id, { content: base + text }); } };
    let gap = false; // text written before a tool call is kept, and the next part starts on a new paragraph (as the server stores it)
    let steps: Step[] = o.into?.steps ?? [];
    let finished = false;
    try {
      await streamChat({ message: userText, history, session: convId }, ctl.signal, (e) => {
        // "Обдумываю ответ" stays visible while the model reasons and closes as soon as it answers or calls a tool.
        const thought = () => { if (steps.some((st) => st.name === "thinking" && st.status === "running")) { steps = steps.map((st) => (st.name === "thinking" && st.status === "running" ? { ...st, status: "ok" as const } : st)); this.chats.patch(convId, reply.id, { steps }); } };
        if (e.type === "delta") { thought(); if (!gap) text += e.text; else if (e.text.trim()) { text += "\n\n" + e.text.trimStart(); gap = false; } paint(); }
        else if (e.type === "thinking") { steps = [...steps, { id: "thinking-" + steps.length, name: "thinking", status: "running" }]; this.chats.patch(convId, reply.id, { steps }); }
        else if (e.type === "tool") {
          if (e.phase === "start") { thought(); if (text.trim()) { text = text.trimEnd(); gap = true; } steps = [...steps, { id: e.id, name: e.name, status: "running" }]; }
          else steps = steps.map((st) => (st.id === e.id ? { ...st, status: e.status, ms: e.ms } : st));
          this.chats.patch(convId, reply.id, { steps });
        }
        else if (e.type === "done") {
          finished = true;
          paint(true);
          thought();
          const patch: Partial<ChatMsg> = { turnId: e.turnId, tools: e.tools, ...(e.memory?.length ? { memoryUsed: e.memory } : {}) };
          if (e.reply && e.reply !== text) patch.content = base + e.reply; // the server may append evidence corrections after streaming
          if (o.into) patch.tools = [...new Set([...(o.into.tools ?? []), ...e.tools])];
          this.chats.patch(convId, reply.id, patch);
        } else if (e.type === "error") {
          finished = true;
          paint(true);
          this.chats.patch(convId, reply.id, { error: /(?:503|временно недоступен|connection timeout)/i.test(e.message) ? "Cloud.ru временно недоступен. Ваше сообщение сохранено в истории чата. Повторите запрос после восстановления связи. " + e.message : e.message, ...(ctl.signal.aborted ? { stopped: true } : {}) });
        }
      });
      if (!finished) this.chats.patch(convId, reply.id, { error: text.trim() ? "Поток прервался. Полученная часть ответа сохранена. Нажмите «Повторить», чтобы создать новый ответ." : "Соединение прервано. Сообщение сохранено — нажмите «Повторить»." });
    } catch (e) {
      paint(true);
      if (ctl.signal.aborted) this.chats.patch(convId, reply.id, { stopped: true });
      else {
        const message = (e as Error).message || "Не удалось получить ответ.";
        this.chats.patch(convId, reply.id, { error: /(?:503|временно недоступен|connection timeout)/i.test(message) ? "Cloud.ru недоступен. Сообщение сохранено в истории. Можно повторить отправку. " + message : message });
      }
    } finally {
      if (!finished) paint(true);
      if (steps.some((st) => st.status === "running")) this.chats.patch(convId, reply.id, { steps: steps.map((st) => (st.status === "running" ? { ...st, status: "error" as const } : st)) });
      if (this.abort === ctl) this.abort = null;
      const done = this.chats.get(convId)?.messages.find((m) => m.id === reply.id);
      if (done && o.prior?.length) this.chats.patch(convId, reply.id, { versions: [...o.prior, versionOf(done)], vi: o.prior.length });
      this.store.set((s) => ({ busyId: null, unread: app.get().chatOpen ? 0 : s.unread + (ctl.signal.aborted ? 0 : 1) }));
      if (finished && done && !done.error && !done.stopped && done.content.trim() && o.question !== undefined) this.extras(convId, reply.id, o.question, done.content);
      this.runQueue();
    }
  }

  /** After an answer: a real title for a new chat and questions to ask next. Never blocks or breaks anything. */
  private extras(convId: string, msgId: string, question: string, reply: string) {
    const conv = this.chats.get(convId);
    if (!conv) return;
    const wantTitle = !conv.named && conv.messages.filter((m) => m.role === "user").length === 1;
    const followUps = app.get().chatFollowUps;
    if (!wantTitle && !followUps) return;
    void api.chatExtras(question.slice(0, 1500), reply.slice(0, 3000), wantTitle, followUps).then((r) => {
      if (!r.ok) return;
      const now = this.chats.get(convId);
      if (!now) return;
      if (r.value.title && wantTitle && !now.named) this.chats.rename(convId, r.value.title, true);
      const last = now.messages[now.messages.length - 1];
      if (followUps && r.value.followUps.length && last?.id === msgId) this.chats.patch(convId, msgId, { followUps: r.value.followUps });
    }).catch(() => { /* optional */ });
  }

  clearUnread() { if (this.store.get().unread) this.store.set({ unread: 0 }); }

  async rate(convId: string, msg: ChatMsg, rating: 1 | -1): Promise<void> {
    if (!msg.turnId) return;
    const r = await api.feedback(msg.turnId, rating);
    if (!r.ok) return;
    this.chats.patch(convId, msg.id, { rating });
    if (msg.rating) return; // a changed vote: lessons were already proposed after the first one
    await api.reflect(msg.turnId); // proposed lessons wait for approval on the Memory page
    await refreshMemory();
  }
}
