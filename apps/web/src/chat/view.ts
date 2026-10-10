import { el, icon, iconButton, type IconName } from "../dom";
import { characterAvatar, greeting } from "./art";
import { app, decideApproval, persistPrefs, type Route } from "../state";
import { groupLabel, type Chats, type ChatMsg, type Conversation } from "./chats";
import { Composer } from "./composer";
import type { ChatController } from "./controller";
import { BRIEF_PROMPT, COMMANDS, quickToCommands, chatToMarkdown, dayLabel, previewOf, relTime, safeFileName, sameDay, speechText, stepLabel, type Command } from "./helpers";
import { fillMessage, msgSignature } from "./message";
import { isSpeaking, speak, speechSupported, stopSpeaking } from "./voice";
import { WindowFrame } from "./window";

interface Row { root: HTMLElement; sig: string }
interface Suggestion { title: string; sub: string; icon: IconName; text?: string; go?: Route }

const GENERIC: Suggestion[] = [
  { title: "Что ты умеешь?", sub: "Коротко о возможностях", icon: "chat", text: "Что ты умеешь? Расскажи коротко." },
  { title: "Покажи модули проекта", sub: "Состояние и связи", icon: "modules", text: "Покажи, какие модули есть в проекте JUUNIBI и в каком они состоянии." },
  { title: "Разбери файл", sub: "Прикрепите текст или код", icon: "file", text: "Я прикреплю файл. Кратко объясни, что в нём." },
];
const SHORTCUTS: [string, string][] = [
  ["Enter", "Отправить сообщение"], ["Shift + Enter", "Новая строка"], ["↑ (поле пустое)", "Изменить последнее сообщение"],
  ["/", "Меню команд"], ["Ctrl + K", "Поиск и команды"], ["Ctrl + J", "Открыть/закрыть чат"], ["Ctrl + Shift + O", "Новый чат"], ["Ctrl + /", "Эта справка"],
  ["Esc", "Закрыть меню, затем чат"], ["Двойной клик по шапке", "На весь экран / обратно"],
];

/** Chat window: history, streaming thread, composer, commands, attachments, voice, move/resize. */
export class ChatView {
  readonly root: HTMLElement;
  private readonly side: HTMLElement;
  private readonly sideList: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly thread: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly toBottom: HTMLButtonElement;
  private readonly banner: HTMLElement;
  private readonly approvals: HTMLElement;
  private readonly titleEl: HTMLElement;
  private sideStatus!: HTMLElement;
  private readonly maxBtn: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly drop: HTMLElement;
  private readonly composer: Composer;
  private readonly frame: WindowFrame;
  private readonly rows = new Map<string, Row>();
  private readonly seps = new Map<string, HTMLElement>();
  private empty: HTMLElement | null = null;
  private emptySig = "";
  private stick = true;
  private editingId: string | null = null;
  private renamingId: string | null = null;
  private speakingId: string | null = null;
  private frameId = 0;
  private lastConv: string | null = null;
  private onClose: () => void = () => {};
  private onNavigate: (r: Route) => void = () => {};

  constructor(private readonly chats: Chats, private readonly ctl: ChatController) {
    // ---- sidebar
    const newBtn = el("button", { type: "button", cls: "new-chat" }, icon("plus", 18), el("span", { textContent: "Новый чат" }));
    newBtn.addEventListener("click", () => this.newChat());
    this.search = el("input", { type: "search", placeholder: "Поиск в чатах", cls: "side-search", attrs: { "aria-label": "Поиск в чатах" } });
    this.search.addEventListener("input", () => this.schedule());
    this.sideList = el("nav", { cls: "side-list", attrs: { "aria-label": "История чатов" } });
    this.sideStatus = el("span", { cls: "side-foot-status" });
    const foot = el("div", { cls: "side-foot" }, characterAvatar(34), el("div", { cls: "side-foot-text" }, el("strong", { textContent: "JUUNIBI" }), this.sideStatus),
      iconButton("settings", "Настройки", () => this.onNavigate("settings")));
    this.side = el("aside", { cls: "chat-side" }, el("div", { cls: "side-top" }, newBtn, this.search), this.sideList, foot);

    // ---- header
    this.titleEl = el("div", { cls: "chat-title" });
    this.maxBtn = iconButton("maximize", "На весь экран", () => this.toggleMax());
    const resetBtn = iconButton("refresh", "Сбросить положение окна", () => this.frame.reset());
    const head = el("header", { cls: "chat-head" }, iconButton("sidebar", "Показать/скрыть историю", () => this.toggleSide()), this.titleEl, el("span", { cls: "grow" }),
      iconButton("help", "Горячие клавиши и команды (Ctrl+/)", () => this.toggleSheet()), resetBtn, iconButton("plus", "Новый чат", () => this.newChat()), this.maxBtn, iconButton("x", "Закрыть чат", () => this.onClose()));

    // ---- thread
    this.approvals = el("div", { cls: "approvals" });
    this.inner = el("div", { cls: "thread-inner" });
    this.thread = el("div", { cls: "thread", attrs: { role: "log", "aria-live": "polite", "aria-label": "Сообщения" } }, this.inner);
    this.thread.addEventListener("scroll", () => {
      const near = this.thread.scrollHeight - this.thread.clientHeight - this.thread.scrollTop < 80;
      this.stick = near; this.toBottom.classList.toggle("show", !near);
      this.root.classList.toggle("scrolled", this.thread.scrollTop > 6);
    });
    this.toBottom = iconButton("arrowDown", "Вниз", () => { this.stick = true; this.scrollDown(true); }, "to-bottom");
    this.banner = el("div", { cls: "chat-banner", hidden: true });
    this.sheet = el("div", { cls: "sheet", hidden: true, attrs: { role: "dialog", "aria-label": "Справка" } });
    this.drop = el("div", { cls: "drop-hint", hidden: true, textContent: "Отпустите, чтобы прикрепить текстовые файлы" });

    // ---- composer
    this.composer = new Composer({
      onSubmit: (text, files) => void this.sendText(text, files),
      onCommand: (c, arg) => void this.runCommand(c, arg),
      onStop: () => this.ctl.stop(),
      onEditLast: () => this.editLast(),
      quick: () => quickToCommands(app.get().assistantSettings?.quickCommands ?? []),
    });

    const main = el("section", { cls: "chat-main" }, head, this.banner, el("div", { cls: "thread-wrap" }, ambient(), this.thread, this.toBottom), this.composer.root, this.sheet, this.drop);
    this.root = el("div", { cls: "chat-window", hidden: true, attrs: { role: "dialog", "aria-label": "Чат с JUUNIBI" } }, this.side, el("div", { cls: "side-scrim" }), main);
    (this.root.querySelector(".side-scrim") as HTMLElement).addEventListener("click", () => this.root.classList.remove("side-open"));
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button.suggest") as HTMLButtonElement | null;
      if (b) { const go = b.dataset.go as Route | undefined; if (go) this.onNavigate(go); else if (b.dataset.text) void this.sendText(b.dataset.text); }
    });
    this.root.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "o" && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.newChat(); }
      else if ((e.key === "/" || e.code === "Slash") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.toggleSheet(); }
    });
    // drag & drop files anywhere in the window
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    this.root.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; this.drop.hidden = false; } });
    this.root.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    this.root.addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; this.drop.hidden = true; } });
    this.root.addEventListener("drop", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; this.drop.hidden = true; void this.composer.addFiles(e.dataTransfer!.files); });

    this.frame = new WindowFrame(this.root, head, () => this.toggleMax());
    chats.store.subscribe(() => this.schedule());
    ctl.store.subscribe(() => this.schedule());
    app.subscribe(() => this.schedule());
    setInterval(() => { if (!this.root.hidden) { this.sideList.dataset.sig = ""; this.schedule(); } }, 30_000);
    this.schedule();
  }

  setHandlers(onClose: () => void, onNavigate: (r: Route) => void) { this.onClose = onClose; this.onNavigate = onNavigate; }
  focus() { this.composer.focus(); }
  /** The "Сегодня" card on Home asks the assistant for the day summary. */
  askBrief() { return this.sendText(BRIEF_PROMPT); }
  /** Sends a message from outside the window (a quick command or a question from Ctrl+K). */
  send(text: string) { return this.sendText(text); }
  /** A fresh chat, as Ctrl+Shift+O does inside the window. */
  startNew() { this.newChat(); }
  resetPosition() { this.frame.reset(); }
  /** Esc: close the innermost transient thing first; "close" means nothing was open. */
  escape(): "handled" | "close" {
    if (!this.sheet.hidden) { this.sheet.hidden = true; return "handled"; }
    if (this.editingId) { this.editingId = null; this.schedule(); return "handled"; }
    if (document.activeElement === this.search && this.search.value) { this.search.value = ""; this.schedule(); return "handled"; }
    if (this.root.classList.contains("side-open")) { this.root.classList.remove("side-open"); return "handled"; }
    return "close";
  }
  onClosed() { this.composer.stopVoice(); stopSpeaking(); this.speakingId = null; }

  // ---------- actions ----------
  private narrow() { return window.innerWidth < 760; }
  private toggleSide() { this.root.classList.toggle(this.narrow() ? "side-open" : "side-hidden"); }
  private toggleMax() { app.set((s) => ({ chatMax: !s.chatMax })); persistPrefs(app.get()); }
  private toggleSheet() {
    this.sheet.hidden = !this.sheet.hidden;
    if (this.sheet.hidden) return;
    const close = iconButton("x", "Закрыть", () => { this.sheet.hidden = true; });
    this.sheet.replaceChildren(
      el("div", { cls: "sheet-head" }, el("h2", { textContent: "Справка" }), close),
      el("h3", { textContent: "Горячие клавиши" }),
      el("dl", {}, ...SHORTCUTS.flatMap(([k, d]) => [el("dt", {}, el("kbd", { cls: "kbd", textContent: k })), el("dd", { textContent: d })])),
      el("h3", { textContent: "Команды" }),
      el("dl", {}, ...COMMANDS.flatMap((c) => [el("dt", {}, el("kbd", { cls: "kbd", textContent: "/" + c.names[0] + (c.arg ? ` <${c.arg}>` : "") })), el("dd", { textContent: c.hint })])),
      el("p", { cls: "muted", textContent: "Файлы: перетащите текстовые файлы в окно или нажмите скрепку (до 5 файлов, до 100 КБ каждый)." }));
    close.focus();
  }
  private newChat() { this.chats.create(); this.root.classList.remove("side-open"); this.editingId = null; this.stick = true; this.schedule(); this.composer.focus(); }
  private editLast() {
    if (this.ctl.busy) return;
    const last = [...(this.chats.active()?.messages ?? [])].reverse().find((m) => m.role === "user");
    if (last) { this.editingId = last.id; this.schedule(); }
  }
  private async sendText(text: string, files: Parameters<ChatController["send"]>[2] = []) {
    if (this.ctl.busy || !app.get().status?.assistant) return;
    const conv = this.chats.active() ?? this.chats.create();
    this.stick = true;
    await this.ctl.send(conv.id, text, files);
  }
  private async runCommand(c: Command, arg: string) {
    const conv = this.chats.active() ?? this.chats.create();
    switch (c.id) {
      case "new": this.newChat(); break;
      case "remember":
        if (!arg) this.ctl.note(conv.id, "Напишите, что запомнить: «/запомни текст».");
        else await this.ctl.remember(conv.id, arg);
        break;
      case "memory": case "modules": case "update": case "settings": this.onNavigate(c.id); break;
      case "export": this.exportChat(conv); break;
      case "brief": void this.sendText(BRIEF_PROMPT); break;
      case "quick": if (c.quick) void this.sendText(arg ? c.quick + "\n\n" + arg : c.quick); break;
      case "clear":
        if (conv.messages.length && confirm("Очистить текущий чат?")) { if (this.ctl.busy) this.ctl.stop(); this.chats.clearMessages(conv.id); }
        break;
      case "scenes": {
        const on = !app.get().showScenes; app.set({ showScenes: on }); persistPrefs(app.get());
        this.ctl.note(conv.id, on ? "Сцены персонажа включены." : "Сцены персонажа выключены.");
        break;
      }
      case "help": this.toggleSheet(); break;
    }
    this.stick = true; this.schedule();
  }
  private exportChat(c: Conversation) {
    const blob = new Blob([chatToMarkdown(c)], { type: "text/markdown;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: safeFileName(c.title) });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.ctl.note(c.id, `Чат сохранён: ${a.download}`);
  }
  private speak(m: ChatMsg) {
    if (this.speakingId === m.id && isSpeaking()) { stopSpeaking(); this.speakingId = null; this.schedule(); return; }
    this.speakingId = m.id; this.schedule();
    speak(speechText(m.content), () => { if (this.speakingId === m.id) { this.speakingId = null; this.schedule(); } });
  }
  private remember(convId: string, text: string) { void this.ctl.remember(convId, text.slice(0, 500)); }
  private scrollDown(smooth = false) { this.thread.scrollTo({ top: this.thread.scrollHeight, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" }); }

  // ---------- rendering ----------
  private schedule() { if (this.frameId) return; this.frameId = requestAnimationFrame(() => { this.frameId = 0; this.render(); }); }

  private render() {
    const s = app.get();
    const conv = this.chats.active();
    const busy = this.ctl.busy;
    const configured = !!s.status?.assistant;

    this.root.classList.toggle("max", s.chatMax);
    this.root.classList.toggle("dens-compact", s.chatDensity === "compact");
    this.root.classList.remove("font-sm", "font-lg"); if (s.chatFont !== "md") this.root.classList.add("font-" + s.chatFont);
    this.maxBtn.replaceChildren(icon(s.chatMax ? "minimize" : "maximize", 18));
    this.maxBtn.title = s.chatMax ? "Свернуть окно" : "На весь экран";
    this.maxBtn.setAttribute("aria-label", this.maxBtn.title);
    const model = (s.assistantSettings?.chat.model || s.status?.model)?.split("/").pop() ?? "";
    const typing = busy && this.ctl.store.get().busyId === conv?.id;
    const lastMsg = conv?.messages[conv.messages.length - 1];
    const running = typing ? lastMsg?.steps?.find((st) => st.status === "running") : undefined;
    const sub = !configured ? (s.status ? "нужен ключ Cloud.ru" : "подключение…") : running ? stepLabel(running.name) : typing ? "печатает" : `на связи${model ? " · " + model : ""}`;
    this.root.classList.toggle("generating", typing);
    this.titleEl.replaceChildren(characterAvatar(34, "head-av"), el("div", { cls: "chat-title-text" }, el("strong", { textContent: "JUUNIBI" }),
      el("span", { cls: "chat-sub", attrs: { "aria-live": "polite" } }, el("i", { cls: "dot " + (configured ? (typing ? "busy" : "on") : "off") }), sub, typing ? el("span", { cls: "dots", attrs: { "aria-hidden": "true" } }, el("i"), el("i"), el("i")) : null)));
    this.sideStatus.textContent = configured ? "На связи" : "Не подключена";
    this.sideStatus.classList.toggle("off", !configured);

    this.banner.hidden = configured || s.status === null;
    if (!this.banner.hidden && !this.banner.firstChild) {
      const go = el("button", { type: "button", textContent: "Открыть настройки" });
      go.addEventListener("click", () => this.onNavigate("settings"));
      this.banner.replaceChildren(icon("alert", 18), el("span", { textContent: "Ключ Cloud.ru не задан — помощник пока не может отвечать." }), go);
    }
    this.composer.loadDraft(conv?.id ?? null);
    this.composer.setState({ configured, busy });
    this.renderApprovals();
    this.renderSide(conv);
    this.renderThread(conv, busy);
    if (conv?.id !== this.lastConv) { this.lastConv = conv?.id ?? null; this.stick = true; this.editingId = null; }
  }


  private renderApprovals() {
    const list = app.get().approvals;
    const key = JSON.stringify(list.map((a) => a.id));
    if (this.approvals.dataset.key === key) return;
    this.approvals.dataset.key = key;
    this.approvals.replaceChildren(...list.map((a) => {
      const no = el("button", { type: "button", cls: "btn", textContent: "Отклонить" });
      const yes = el("button", { type: "button", cls: "btn primary", textContent: "Разрешить" });
      no.addEventListener("click", () => void decideApproval(a.id, false));
      yes.addEventListener("click", () => void decideApproval(a.id, true));
      return el("div", { cls: "approval", attrs: { role: "group" } }, el("strong", { textContent: `Нужно разрешение: ${a.tool} (${a.risk})` }),
        el("pre", { textContent: JSON.stringify(a.args, null, 2).slice(0, 1500) }), el("div", { cls: "row" }, no, yes));
    }));
    if (list.length) this.stick = true;
  }

  private renderSide(active: Conversation | undefined) {
    const q = this.search.value.trim().toLowerCase();
    const items = this.chats.store.get().items
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const sig = JSON.stringify([items.map((c) => [c.id, c.title, c.updatedAt, c.messages.length, relTime(c.updatedAt)]), active?.id, this.renamingId, q, this.ctl.store.get().busyId]);
    if (this.sideList.dataset.sig === sig) return;
    this.sideList.dataset.sig = sig;
    if (!items.length) { this.sideList.replaceChildren(el("p", { cls: "side-empty", textContent: q ? "Ничего не найдено" : "Здесь появится история чатов" })); return; }
    const out: Node[] = [];
    let last = "";
    for (const c of items) {
      const label = groupLabel(c.updatedAt);
      if (label !== last) { out.push(el("h3", { cls: "side-group", textContent: label })); last = label; }
      out.push(this.sideItem(c, c.id === active?.id));
    }
    this.sideList.replaceChildren(...out);
  }

  private sideItem(c: Conversation, active: boolean): HTMLElement {
    const row = el("div", { cls: "side-item" + (active ? " active" : "") });
    if (this.renamingId === c.id) {
      const input = el("input", { type: "text", value: c.title, maxLength: 120, cls: "rename", attrs: { "aria-label": "Название чата" } });
      const done = (save: boolean) => { const id = this.renamingId; this.renamingId = null; if (save && id) this.chats.rename(id, input.value); this.sideList.dataset.sig = ""; this.schedule(); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); } });
      input.addEventListener("blur", () => { if (this.renamingId) done(true); });
      row.append(input);
      queueMicrotask(() => { input.focus(); input.select(); });
      return row;
    }
    const preview = previewOf(c.messages);
    const busy = this.ctl.store.get().busyId === c.id;
    const open = el("button", { type: "button", cls: "side-open-btn", title: c.title, attrs: active ? { "aria-current": "true" } : {} },
      el("span", { cls: "side-line" }, el("span", { cls: "side-title", textContent: c.title }), busy ? el("i", { cls: "spin sm" }) : el("span", { cls: "side-time", textContent: c.messages.length ? relTime(c.updatedAt) : "" })),
      preview ? el("span", { cls: "side-preview", textContent: preview }) : null);
    open.addEventListener("click", () => { this.chats.select(c.id); this.stick = true; this.root.classList.remove("side-open"); });
    row.append(open, el("span", { cls: "side-actions" },
      iconButton("edit", "Переименовать", (e) => { e.stopPropagation(); this.renamingId = c.id; this.sideList.dataset.sig = ""; this.schedule(); }, "icon-btn sm"),
      iconButton("trash", "Удалить чат", (e) => { e.stopPropagation(); if (confirm(`Удалить чат «${c.title}»?`)) { if (this.ctl.store.get().busyId === c.id) this.ctl.stop(); this.chats.remove(c.id); } }, "icon-btn sm")));
    return row;
  }

  /** Starter prompts only. Status nudges (updates, memory to approve) live on the Home page, not here. */
  private suggestions(): Suggestion[] {
    return GENERIC;
  }

  private renderThread(conv: Conversation | undefined, busy: boolean) {
    const msgs = conv?.messages ?? [];
    if (!msgs.length) {
      for (const r of this.rows.values()) r.root.remove();
      this.rows.clear();
      for (const sp of this.seps.values()) sp.remove();
      this.seps.clear();
      const sug = this.suggestions();
      const sig = JSON.stringify(sug);
      if (!this.empty || sig !== this.emptySig) {
        this.emptySig = sig;
        this.empty = el("div", { cls: "empty" }, characterAvatar(88, "hero-av"), el("h2", { textContent: greeting() + "!" }), el("p", { cls: "empty-sub", textContent: "Чем могу помочь?" }),
          el("div", { cls: "suggestions" }, ...sug.map((x) => el("button", { type: "button", cls: "suggest", attrs: { ...(x.text ? { "data-text": x.text } : {}), ...(x.go ? { "data-go": x.go } : {}) } },
            icon(x.icon, 20), el("span", { cls: "suggest-text" }, el("strong", { textContent: x.title }), el("span", { textContent: x.sub }))))),
          el("p", { cls: "muted hint-line", textContent: "Подсказка: «/» — команды, скрепка — файлы, перетащите файл в окно." }));
        this.inner.replaceChildren(this.empty, this.approvals);
      }
      return;
    }
    if (this.empty) { this.empty.remove(); this.empty = null; this.emptySig = ""; }

    const wanted = new Set(msgs.map((m) => m.id));
    for (const [id, r] of this.rows) if (!wanted.has(id)) { r.root.remove(); this.rows.delete(id); }
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    const busyId = this.ctl.store.get().busyId;
    const order: HTMLElement[] = [];
    const usedSeps = new Set<string>();
    let prevTs = 0;
    for (const m of msgs) {
      if (!prevTs || !sameDay(prevTs, m.at)) {
        const key = String(new Date(m.at).setHours(0, 0, 0, 0));
        usedSeps.add(key);
        let sep = this.seps.get(key);
        if (!sep) { sep = el("div", { cls: "day-sep", attrs: { role: "separator" } }, el("span")); this.seps.set(key, sep); }
        const label = dayLabel(m.at);
        if (sep.firstChild!.textContent !== label) sep.firstChild!.textContent = label;
        order.push(sep);
      }
      prevTs = m.at;
      const c = {
        convId: conv!.id, busy, editing: this.editingId === m.id, speaking: this.speakingId === m.id,
        streaming: busy && busyId === conv!.id && m.id === lastAssistant?.id && !m.turnId && !m.error && !m.stopped,
        isLast: m.id === lastAssistant?.id,
      };
      const sig = msgSignature(m, c);
      let row = this.rows.get(m.id);
      if (!row) { row = { root: el("article", { cls: `msg ${m.role}` }), sig: "" }; this.rows.set(m.id, row); }
      if (row.sig !== sig) {
        row.sig = sig;
        fillMessage(row.root, m, { ...c, ctl: this.ctl, onEdit: (id) => { this.editingId = id; this.schedule(); }, onCancelEdit: () => { this.editingId = null; this.schedule(); },
          onSaveEdit: (id, text) => { this.editingId = null; if (text.trim()) void this.ctl.edit(conv!.id, id, text); else this.schedule(); },
          onRemember: (t) => this.remember(conv!.id, t), onSpeak: (mm) => this.speak(mm) });
      }
      order.push(row.root);
    }
    for (const [key, sep] of this.seps) if (!usedSeps.has(key)) { sep.remove(); this.seps.delete(key); }
    let prev: HTMLElement | null = null;
    for (const node of order) {
      if (node.parentElement !== this.inner || node.previousElementSibling !== prev) this.inner.insertBefore(node, prev ? prev.nextSibling : this.inner.firstChild);
      prev = node;
    }
    this.inner.append(this.approvals); // pending approvals sit at the end of the conversation
    if (this.stick) this.scrollDown();
  }
}

/** A handful of slow golden sparks drifting upwards behind the conversation (pure CSS; calm by design). */
function ambient(): HTMLElement {
  const sparks = Array.from({ length: 14 }, (_, i) => {
    const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1; // deterministic pseudo-random
    const sp = el("i");
    sp.style.setProperty("--x", Math.round(r(1) * 100) + "%");
    sp.style.setProperty("--s", (2 + Math.round(r(2) * 3)) + "px");
    sp.style.setProperty("--d", (14 + Math.round(r(3) * 16)) + "s");
    sp.style.setProperty("--w", (-Math.round(r(4) * 30)) + "s");
    return sp;
  });
  return el("div", { cls: "ambient", attrs: { "aria-hidden": "true" } }, ...sparks);
}
