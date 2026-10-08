import { Store } from "@juunibi/core";
import { api } from "../api";
import { app, refreshMemory } from "../state";
import { DEFAULT_TITLE, titleFrom, type Chats, type ChatMsg } from "./chats";
import { streamChat } from "./stream";

export interface CtlState { busyId: string | null; unread: number }

/** Runs generations independently of the chat window, so a reply keeps streaming while the window is closed. */
export class ChatController {
  readonly store = new Store<CtlState>({ busyId: null, unread: 0 });
  private abort: AbortController | null = null;

  constructor(private readonly chats: Chats) {}

  get busy(): boolean { return this.store.get().busyId !== null; }

  /** Conversation history the model should see: finished, non-empty turns only. */
  private historyBefore(convId: string, msgId?: string): { role: "user" | "assistant"; content: string }[] {
    const c = this.chats.get(convId);
    if (!c) return [];
    const upTo = msgId ? c.messages.findIndex((m) => m.id === msgId) : c.messages.length;
    return c.messages.slice(0, upTo < 0 ? c.messages.length : upTo)
      .filter((m) => m.content.trim() && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async send(convId: string, text: string): Promise<void> {
    const content = text.trim();
    if (!content || this.busy) return;
    const conv = this.chats.get(convId);
    if (!conv) return;
    const history = this.historyBefore(convId);
    this.chats.append(convId, { role: "user", content });
    if (conv.title === DEFAULT_TITLE && conv.messages.length === 0) this.chats.rename(convId, titleFrom(content));
    await this.generate(convId, content, history);
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
    // drop everything after the user message, keep the user message itself
    const after = c.messages[idx + 1];
    if (after) this.chats.truncateFrom(convId, after.id);
    await this.generate(convId, lastUser.content, history);
  }

  /** Replaces a user message with edited text and regenerates from there. */
  async edit(convId: string, msgId: string, newText: string): Promise<void> {
    const content = newText.trim();
    if (!content || this.busy) return;
    const history = this.historyBefore(convId, msgId);
    this.chats.truncateFrom(convId, msgId);
    this.chats.append(convId, { role: "user", content });
    await this.generate(convId, content, history);
  }

  stop() { this.abort?.abort(); }

  private async generate(convId: string, userText: string, history: { role: "user" | "assistant"; content: string }[]): Promise<void> {
    const reply = this.chats.append(convId, { role: "assistant", content: "" });
    const ctl = new AbortController();
    this.abort = ctl;
    this.store.set({ busyId: convId });

    // The character "scene" is optional flavour; it must never delay or break the real answer.
    if (app.get().showScenes) {
      void api.nextScene().then((r) => {
        if (r.ok) this.chats.patch(convId, reply.id, { scene: { action: r.value.action.text, ...(r.value.phrase ? { phrase: r.value.phrase.text } : {}) } });
      });
    }

    let text = "";
    let finished = false;
    try {
      await streamChat({ message: userText, history }, ctl.signal, (e) => {
        if (e.type === "delta") { text += e.text; this.chats.patch(convId, reply.id, { content: text }); }
        else if (e.type === "tool") { /* shown after completion via `tools` */ }
        else if (e.type === "done") {
          finished = true;
          const patch: Partial<ChatMsg> = { turnId: e.turnId, tools: e.tools };
          if (!text && e.reply) patch.content = e.reply; // server returned a reply without deltas
          this.chats.patch(convId, reply.id, patch);
        } else if (e.type === "error") {
          finished = true;
          this.chats.patch(convId, reply.id, { error: e.message, ...(ctl.signal.aborted ? { stopped: true } : {}) });
        }
      });
      if (!finished) this.chats.patch(convId, reply.id, { error: "Соединение прервано." });
    } catch (e) {
      if (ctl.signal.aborted) this.chats.patch(convId, reply.id, { stopped: true });
      else this.chats.patch(convId, reply.id, { error: (e as Error).message || "Не удалось получить ответ." });
    } finally {
      if (this.abort === ctl) this.abort = null;
      this.store.set((s) => ({ busyId: null, unread: app.get().chatOpen ? 0 : s.unread + (ctl.signal.aborted ? 0 : 1) }));
    }
  }

  clearUnread() { if (this.store.get().unread) this.store.set({ unread: 0 }); }

  async rate(convId: string, msg: ChatMsg, rating: 1 | -1): Promise<void> {
    if (!msg.turnId) return;
    const r = await api.feedback(msg.turnId, rating);
    if (!r.ok) return;
    this.chats.patch(convId, msg.id, { rating });
    await api.reflect(msg.turnId); // proposed lessons wait for approval on the Memory page
    await refreshMemory();
  }
}
