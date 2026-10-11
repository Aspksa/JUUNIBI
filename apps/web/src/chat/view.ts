import { copyText, el, icon, iconButton, type IconName } from "../dom";
import { characterAvatar, greeting } from "./art";
import { app, decideApproval, persistPrefs, refreshSettings, type Route } from "../state";
import { groupLabel, type ChatArea, type Chats, type ChatMsg, type Conversation } from "./chats";
import { Composer } from "./composer";
import type { ChatController } from "./controller";
import { BRIEF_PROMPT, COMMANDS, contextInfo, fillPlaceholders, quickToCommands, chatToMarkdown, dayLabel, previewOf, relTime, safeFileName, sameDay, snippetAround, speechText, stepLabel, utf8Base64, withFiles, type Command, MAX_FILES, type Attachment } from "./helpers";
import { fillMessage, msgSignature } from "./message";
import { isSpeaking, speak, speechSupported, stopSpeaking } from "./voice";
import { WindowFrame } from "./window";
import { api, type DiskFile } from "../api";
import { showToast } from "../toast";
import { DISK_DRAG } from "../pages/disk-link";
import { pickDiskFiles } from "../pages/disk-dialogs";
import { mdHooks } from "../markdown";

interface Row { root: HTMLElement; sig: string }
interface Suggestion { title: string; sub: string; icon: IconName; text?: string; chat?: string; disk?: string }
type AreaFilter = "all" | ChatArea;

const GENERIC: Suggestion[] = [
  { title: "Что ты умеешь?", sub: "Коротко о возможностях", icon: "chat", text: "Что ты умеешь? Расскажи коротко." },
  { title: "Покажи модули проекта", sub: "Состояние и связи", icon: "modules", text: "Покажи, какие модули есть в проекте JUUNIBI и в каком они состоянии." },
];
const SHORTCUTS: [string, string][] = [
  ["Enter", "Отправить сообщение (пока JUUNIBI отвечает, оно встанет в очередь)"], ["Shift + Enter", "Новая строка"], ["↑ (поле пустое)", "Изменить последнее сообщение"],
  ["/", "Меню команд"], ["Ctrl + K", "Поиск и команды"], ["Ctrl + J", "Открыть/закрыть чат"], ["Ctrl + Shift + O", "Новый чат"],
  ["Alt + ↑ / Alt + ↓", "Предыдущий / следующий чат в истории"], ["Alt + C", "Скопировать последний ответ"], ["Ctrl + /", "Эта справка"],
  ["Esc", "Закрыть меню, затем чат"], ["Двойной клик по шапке", "На весь экран / обратно"],
];
const AREAS: [AreaFilter, string][] = [["all", "Все"], ["work", "Работа"], ["personal", "Личное"]];
const AREA_KEY = "juunibi.chat.area";
const DISK_FOLDER = "Из чата";
/** Cloud.ru models, asked once per page load (the list rarely changes). */
let modelList: string[] | null = null;

/** Chat window: history, streaming thread, composer, commands, attachments, voice, move/resize. */
export class ChatView {
  readonly root: HTMLElement;
  private readonly side: HTMLElement;
  private readonly sideList: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly areaBar: HTMLElement;
  private readonly selectBar: HTMLElement;
  private readonly thread: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly toBottom: HTMLButtonElement;
  private readonly banner: HTMLElement;
  private readonly ctxBanner: HTMLElement;
  private readonly approvals: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly ctxRing: HTMLButtonElement;
  private readonly main: HTMLElement;
  private readonly selPop: HTMLElement;
  private sideStatus!: HTMLElement;
  private readonly maxBtn: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly drop: HTMLElement;
  private readonly composer: Composer;
  private readonly frame: WindowFrame;
  private readonly rows = new Map<string, Row>();
  private readonly seps = new Map<string, HTMLElement>();
  private readonly expanded = new Set<string>();
  private pop: HTMLElement | null = null;
  private empty: HTMLElement | null = null;
  private emptySig = "";
  private stick = true;
  private editingId: string | null = null;
  private renamingId: string | null = null;
  private speakingId: string | null = null;
  private frameId = 0;
  private lastConv: string | null = null;
  private seen = 0;
  private unseen = 0;
  private area: AreaFilter = "all";
  private selecting: Set<string> | null = null;
  private jump: string | null = null;
  private recentDisk: DiskFile | null | undefined;
  private onClose: () => void = () => {};
  private onNavigate: (r: Route) => void = () => {};

  constructor(private readonly chats: Chats, private readonly ctl: ChatController) {
    try { const a = localStorage.getItem(AREA_KEY); if (a === "work" || a === "personal") this.area = a; } catch { /* private mode */ }
    // ---- sidebar
    const newBtn = el("button", { type: "button", cls: "new-chat" }, icon("plus", 18), el("span", { textContent: "Новый чат" }));
    newBtn.addEventListener("click", () => this.newChat());
    this.search = el("input", { type: "search", placeholder: "Поиск в чатах", cls: "side-search", attrs: { "aria-label": "Поиск в чатах" } });
    this.search.addEventListener("input", () => this.schedule());
    this.areaBar = el("div", { cls: "side-areas", attrs: { role: "radiogroup", "aria-label": "Метка" } });
    this.selectBar = el("div", { cls: "side-select", hidden: true });
    this.sideList = el("nav", { cls: "side-list", attrs: { "aria-label": "История чатов" } });
    this.sideStatus = el("span", { cls: "side-foot-status" });
    const pick = iconButton("circleCheck", "Выбрать несколько чатов", () => this.toggleSelecting(), "icon-btn sm side-pick");
    const foot = el("div", { cls: "side-foot" }, characterAvatar(34), el("div", { cls: "side-foot-text" }, el("strong", { textContent: "JUUNIBI" }), this.sideStatus),
      iconButton("settings", "Настройки", () => this.onNavigate("settings")));
    this.side = el("aside", { cls: "chat-side" }, el("div", { cls: "side-top" }, newBtn, el("div", { cls: "side-row" }, this.search, pick), this.areaBar), this.selectBar, this.sideList, foot);

    // ---- header: only what is used all the time; the rest is in «⋯»
    this.titleEl = el("div", { cls: "chat-title" });
    this.maxBtn = iconButton("maximize", "На весь экран", () => this.toggleMax());
    this.ctxRing = el("button", { type: "button", cls: "ctx-ring", hidden: true });
    this.ctxRing.addEventListener("click", (e) => this.toggleCtxNote(e.currentTarget as HTMLElement));
    const more = iconButton("more", "Ещё", (e) => this.openMenu(e.currentTarget as HTMLElement));
    more.setAttribute("aria-haspopup", "menu");
    const head = el("header", { cls: "chat-head" }, iconButton("sidebar", "Показать/скрыть историю", () => this.toggleSide()), this.titleEl, el("span", { cls: "grow" }),
      this.ctxRing, iconButton("plus", "Новый чат (Ctrl+Shift+O)", () => this.newChat()), this.maxBtn, more, iconButton("x", "Закрыть чат", () => this.onClose()));

    // ---- thread
    this.approvals = el("div", { cls: "approvals" });
    this.inner = el("div", { cls: "thread-inner" });
    this.thread = el("div", { cls: "thread", attrs: { role: "log", "aria-live": "polite", "aria-label": "Сообщения" } }, this.inner);
    this.thread.addEventListener("scroll", () => {
      const near = this.thread.scrollHeight - this.thread.clientHeight - this.thread.scrollTop < 80;
      this.stick = near;
      if (near) this.unseen = 0;
      this.paintToBottom();
      this.root.classList.toggle("scrolled", this.thread.scrollTop > 6);
      this.selPop.hidden = true;
    });
    this.toBottom = iconButton("arrowDown", "Вниз", () => { this.stick = true; this.unseen = 0; this.paintToBottom(); this.scrollDown(true); }, "to-bottom");
    this.banner = el("div", { cls: "chat-banner", hidden: true });
    this.ctxBanner = el("div", { cls: "ctx-banner", hidden: true });
    this.sheet = el("div", { cls: "sheet", hidden: true, attrs: { role: "dialog", "aria-label": "Справка" } });
    this.drop = el("div", { cls: "drop-hint", hidden: true, textContent: "Отпустите, чтобы прикрепить текстовые файлы" });
    this.selPop = el("div", { cls: "sel-pop", hidden: true, attrs: { role: "toolbar", "aria-label": "Выделенный текст" } });

    // ---- composer
    this.composer = new Composer({
      onSubmit: (text, files) => void this.sendText(text, files),
      onCommand: (c, arg) => void this.runCommand(c, arg),
      onStop: () => this.ctl.stop(),
      onEditLast: () => this.editLast(),
      onDisk: () => void this.pickFromDisk(),
      onUnqueue: (id) => this.ctl.unqueue(id),
      quick: () => quickToCommands(app.get().assistantSettings?.quickCommands ?? []),
    });

    this.main = el("section", { cls: "chat-main" }, head, this.banner, el("div", { cls: "thread-wrap" }, ambient(), this.thread, this.toBottom), this.ctxBanner, this.composer.root, this.sheet, this.drop, this.selPop);
    this.root = el("div", { cls: "chat-window", hidden: true, attrs: { role: "dialog", "aria-label": "Чат с JUUNIBI" } }, this.side, el("div", { cls: "side-scrim" }), this.main);
    (this.root.querySelector(".side-scrim") as HTMLElement).addEventListener("click", () => this.root.classList.remove("side-open"));
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button.suggest") as HTMLButtonElement | null;
      if (!b) return;
      if (b.dataset.chat) { this.chats.select(b.dataset.chat); this.stick = true; }
      else if (b.dataset.disk) void this.askAboutDisk(b.dataset.disk);
      else if (b.dataset.text) void this.sendText(b.dataset.text);
    });
    this.root.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "o" && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.newChat(); }
      else if ((e.key === "/" || e.code === "Slash") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.toggleSheet(); }
      else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); this.stepChat(e.key === "ArrowUp" ? -1 : 1); }
      else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyC") { e.preventDefault(); void this.copyLast(); }
    });
    this.setupDrops();
    this.setupSelection();
    this.setupTouch();
    mdHooks.saveTable = (csv) => void this.saveToDisk("таблица " + stamp() + ".csv", csv);

    this.frame = new WindowFrame(this.root, head, () => this.toggleMax());
    chats.store.subscribe(() => this.schedule());
    ctl.store.subscribe(() => this.schedule());
    app.subscribe(() => this.schedule());
    setInterval(() => { if (!this.root.hidden) { this.sideList.dataset.sig = ""; this.schedule(); } }, 30_000);
    this.schedule();
  }

  setHandlers(onClose: () => void, onNavigate: (r: Route) => void) { this.onClose = onClose; this.onNavigate = onNavigate; }
  focus() { this.composer.focus(); this.recentDisk = undefined; this.emptySig = ""; this.schedule(); }
  /** The "Сегодня" card on Home asks the assistant for the day summary. */
  askBrief() { return this.sendText(BRIEF_PROMPT); }
  /** A quick command: its text with {дата}, {время}, {день}, {буфер} filled in, then what was typed after it. */
  private async sendQuick(text: string, arg: string) {
    // reading the clipboard needs https or localhost; on the phone {буфер} stays empty
    const clipboard = /\{буфер\}/i.test(text) && window.isSecureContext ? await navigator.clipboard?.readText().catch(() => "") ?? "" : "";
    const body = fillPlaceholders(text, { now: new Date(), clipboard });
    return this.sendText(arg ? body + "\n\n" + arg : body);
  }
  /** Sends a message from outside the window (a quick command or a question from Ctrl+K). */
  send(text: string) { return this.sendText(text); }
  /** A fresh chat, as Ctrl+Shift+O does inside the window. */
  startNew() { this.newChat(); }
  /** «Спросить JUUNIBI о файле» from the Disk: a fresh chat with the file's text attached and the question sent. */
  askAbout(name: string, text: string, question: string): string | null {
    // check first: a busy or unconfigured chat would otherwise open empty and drop the question
    if (this.ctl.busy) return "JUUNIBI ещё отвечает. Дождитесь ответа и спросите снова";
    if (!app.get().status?.assistant) return "Чат пока не подключён: настройте модель в «Настройках»";
    this.newChat();
    void this.sendText(question, [{ name, size: new Blob([text]).size, text }]);
    return null;
  }
  /** Text from «Диск» for the composer (a menu item or a drop on the window); returns why it could not. */
  attachTexts(list: Attachment[]): string | null {
    if (!app.get().status?.assistant) return "Чат пока не подключён: настройте модель в «Настройках»";
    // attach to the chat that will be on screen: switching to it later would clear the composer
    if (!this.chats.active()) this.chats.create();
    this.composer.loadDraft(this.chats.active()?.id ?? null);
    const rejected = this.composer.addTexts(list);
    return rejected.length === list.length ? "Не прикреплено: " + rejected.join("; ") : null;
  }
  /** Reads files of «Диск» by id (text, PDF, Word, Excel, PowerPoint) and attaches them. */
  async attachDisk(ids: string[]) {
    const out: Attachment[] = [], failed: string[] = [];
    for (const id of ids.slice(0, MAX_FILES)) {
      const r = await api.diskText(id);
      if (!r.ok) { failed.push(r.error.message); continue; }
      const text = r.value.text.length > 45000 ? r.value.text.slice(0, 45000) + "\n\n[… дальше файл обрезан]" : r.value.text;
      out.push({ name: /\.(txt|md|csv|json|log)$/i.test(r.value.name) ? r.value.name : r.value.name.replace(/\.[^.]+$/, "") + ".txt", size: new Blob([text]).size, text });
    }
    const why = out.length ? this.attachTexts(out) : failed[0] ?? "Файлы не прочитались";
    if (why) showToast(why);
    else if (failed.length) showToast("Не прочитались: " + failed.join("; "));
  }
  resetPosition() { this.frame.reset(); }
  /** Esc: close the innermost transient thing first; "close" means nothing was open. */
  escape(): "handled" | "close" {
    if (this.pop) { this.closePop(); return "handled"; }
    if (!this.selPop.hidden) { this.selPop.hidden = true; return "handled"; }
    if (!this.sheet.hidden) { this.sheet.hidden = true; return "handled"; }
    if (this.editingId) { this.editingId = null; this.schedule(); return "handled"; }
    if (this.selecting) { this.toggleSelecting(); return "handled"; }
    if (document.activeElement === this.search && this.search.value) { this.search.value = ""; this.schedule(); return "handled"; }
    if (this.root.classList.contains("side-open")) { this.root.classList.remove("side-open"); return "handled"; }
    return "close";
  }
  onClosed() { this.composer.stopVoice(); stopSpeaking(); this.speakingId = null; this.closePop(); }

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
      el("p", { cls: "muted", textContent: "Файлы: перетащите в окно, нажмите скрепку или «Диск» (до 5 файлов). Выделите текст в ответе, чтобы спросить о нём или процитировать." }));
    close.focus();
  }
  private newChat() { this.chats.create(); this.root.classList.remove("side-open"); this.editingId = null; this.stick = true; this.schedule(); this.composer.focus(); }
  private editLast() {
    if (this.ctl.busy) return;
    const last = [...(this.chats.active()?.messages ?? [])].reverse().find((m) => m.role === "user");
    if (last) { this.editingId = last.id; this.schedule(); }
  }
  private async sendText(text: string, files: Parameters<ChatController["send"]>[2] = []) {
    if (!app.get().status?.assistant) return;
    const conv = this.chats.active() ?? this.chats.create();
    this.stick = true;
    if (this.ctl.busy) { this.ctl.enqueue(conv.id, text.trim(), files); return; }
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
      case "quick": if (c.quick) void this.sendQuick(c.quick, arg); break;
      case "clear": this.clearChat(conv); break;
      case "scenes": {
        const on = !app.get().showScenes; app.set({ showScenes: on }); persistPrefs(app.get());
        this.ctl.note(conv.id, on ? "Сцены персонажа включены." : "Сцены персонажа выключены.");
        break;
      }
      case "help": this.toggleSheet(); break;
    }
    this.stick = true; this.schedule();
  }
  private clearChat(conv: Conversation) {
    if (conv.messages.length && confirm("Очистить текущий чат?")) { if (this.ctl.store.get().busyId === conv.id) this.ctl.stop(); this.chats.clearMessages(conv.id); }
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

  /** Alt+↑/↓: the chat above or below in the history list (as it is filtered now). */
  private stepChat(dir: -1 | 1) {
    const ids = this.visibleChats().map((c) => c.id);
    if (!ids.length) return;
    const i = ids.indexOf(this.chats.active()?.id ?? "");
    const next = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + dir))]!;
    if (next !== this.chats.active()?.id) { this.chats.select(next); this.stick = true; }
  }
  private async copyLast() {
    const last = [...(this.chats.active()?.messages ?? [])].reverse().find((m) => m.role === "assistant" && m.content.trim());
    if (!last) { showToast("Пока нечего копировать", { ms: 2000 }); return; }
    showToast(await copyText(last.content) ? "Последний ответ скопирован" : "Не удалось скопировать", { ms: 2000 });
  }

  /** Files from «Диск» through a picker (the paperclip takes files of this computer). */
  private async pickFromDisk() {
    if (!app.get().status?.assistant) return;
    const r = await api.diskList();
    if (!r.ok) { showToast(r.error.message); return; }
    const files = await pickDiskFiles({ files: r.value.files, title: "Файлы с Диска для чата", max: MAX_FILES, ok: "Прикрепить" });
    if (files.length) await this.attachDisk(files.map((f) => f.id));
  }
  private async askAboutDisk(id: string) {
    const r = await api.diskText(id);
    if (!r.ok) { showToast(r.error.message); return; }
    const text = r.value.text.length > 45000 ? r.value.text.slice(0, 45000) + "\n\n[… дальше файл обрезан]" : r.value.text;
    const why = this.askAbout(r.value.name, text, "Кратко расскажи, что в этом файле и на что обратить внимание.");
    if (why) showToast(why);
  }
  /** Saves text to «Диск» in the folder «Из чата» (created on first use). */
  private async saveToDisk(name: string, text: string) {
    const list = await api.diskList();
    if (list.ok && !list.value.folders.includes(DISK_FOLDER)) await api.diskFolder(DISK_FOLDER);
    const r = await api.diskUpload(name.replace(/[\\/:*?"<>|]+/g, " ").trim(), DISK_FOLDER, utf8Base64(text));
    showToast(r.ok ? `Сохранено на Диск: «${DISK_FOLDER}/${r.value.name}»` : "Не сохранилось: " + r.error.message, { ms: 4000 });
  }
  private saveAnswer(m: ChatMsg) {
    const conv = this.chats.active();
    void this.saveToDisk(safeFileName(conv?.title ?? "Ответ").replace(/\.md$/, "") + " " + stamp() + ".md", m.content);
  }

  // ---------- popovers: «⋯», model, context ----------
  private closePop() { this.pop?.remove(); this.pop = null; }
  private openPop(anchor: HTMLElement, content: HTMLElement, cls = "") {
    const was = this.pop?.dataset.for === anchor.dataset.popId && anchor.dataset.popId;
    this.closePop();
    if (was) return null;
    anchor.dataset.popId ??= String(Math.random()).slice(2);
    const pop = el("div", { cls: ("chat-pop " + cls).trim() }, content);
    pop.dataset.for = anchor.dataset.popId;
    const a = anchor.getBoundingClientRect(), m = this.main.getBoundingClientRect();
    pop.style.top = Math.round(a.bottom - m.top + 6) + "px";
    if (cls.includes("left")) pop.style.left = Math.max(8, Math.round(a.left - m.left - 8)) + "px";
    else pop.style.right = Math.max(8, Math.round(m.right - a.right)) + "px";
    this.main.append(pop);
    this.pop = pop;
    const away = (e: Event) => { if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) { document.removeEventListener("pointerdown", away, true); if (this.pop === pop) this.closePop(); } };
    document.addEventListener("pointerdown", away, true);
    return pop;
  }
  private menuItem(ic: IconName, label: string, run: () => void, o: { checked?: boolean; danger?: boolean } = {}) {
    const b = el("button", { type: "button", cls: "pop-item" + (o.danger ? " danger" : ""), attrs: { role: o.checked === undefined ? "menuitem" : "menuitemradio", ...(o.checked !== undefined ? { "aria-checked": String(o.checked) } : {}) } },
      icon(ic, 16), el("span", { textContent: label }), o.checked ? icon("check", 14) : null);
    b.addEventListener("click", () => { this.closePop(); run(); });
    return b;
  }
  private openMenu(anchor: HTMLElement) {
    const conv = this.chats.active();
    const items: Node[] = [];
    if (conv) {
      items.push(
        this.menuItem("edit", "Переименовать", () => { this.root.classList.remove("side-hidden"); this.renamingId = conv.id; this.sideList.dataset.sig = ""; this.schedule(); }),
        this.menuItem("pin", conv.pinned ? "Открепить" : "Закрепить сверху", () => this.chats.setPinned(conv.id, !conv.pinned)),
        el("div", { cls: "pop-sep", textContent: "Метка" }),
        this.menuItem("board", "Работа", () => this.chats.setArea(conv.id, conv.area === "work" ? null : "work"), { checked: conv.area === "work" }),
        this.menuItem("home", "Личное", () => this.chats.setArea(conv.id, conv.area === "personal" ? null : "personal"), { checked: conv.area === "personal" }),
        el("div", { cls: "pop-line" }),
        this.menuItem("copy", "Дублировать чат", () => { this.chats.duplicate(conv.id); this.stick = true; showToast("Копия чата открыта", { ms: 2500 }); }),
        this.menuItem("download", "Сохранить в файл", () => this.exportChat(conv)),
        this.menuItem("trash", "Очистить чат", () => this.clearChat(conv), { danger: true }),
        el("div", { cls: "pop-line" }));
    }
    items.push(this.menuItem("help", "Справка и клавиши", () => this.toggleSheet()));
    if (!this.narrow() && !app.get().chatMax) items.push(this.menuItem("refresh", "Вернуть окно на место", () => this.frame.reset()));
    this.openPop(anchor, el("div", { cls: "pop-menu", attrs: { role: "menu" } }, ...items));
  }
  /** Click on the model under the title: the list of Cloud.ru models, the chosen one is saved at once. */
  private openModels(anchor: HTMLElement) {
    const s = app.get().assistantSettings;
    if (!s) return;
    const current = s.chat.model;
    const search = el("input", { type: "search", cls: "pop-search", placeholder: "Найти модель", attrs: { "aria-label": "Найти модель" } });
    const list = el("div", { cls: "pop-list", attrs: { role: "listbox", "aria-label": "Модели" } });
    const draw = () => {
      if (!modelList) { list.replaceChildren(el("p", { cls: "pop-note", textContent: "Загружаю список моделей…" })); return; }
      const q = search.value.trim().toLowerCase();
      const shown = [current, ...modelList.filter((m) => m !== current)].filter((m) => m && (!q || m.toLowerCase().includes(q))).slice(0, 60);
      list.replaceChildren(...shown.map((m) => {
        const b = el("button", { type: "button", cls: "pop-item mono", title: m, attrs: { role: "option", "aria-selected": String(m === current) } }, el("span", { textContent: m.split("/").pop() ?? m }), m === current ? icon("check", 14) : null);
        b.addEventListener("click", async () => {
          this.closePop();
          if (m === current) return;
          const r = await api.saveAssistantSettings({ chat: { model: m, fallbackModel: s.chat.fallbackModel, reasoning: s.chat.reasoning } });
          if (r.ok) { app.set({ assistantSettings: r.value }); showToast("Модель: " + (m.split("/").pop() ?? m), { ms: 2500 }); void refreshSettings(); }
          else showToast("Не удалось сменить модель: " + r.error.message);
        });
        return b;
      }), ...(!shown.length ? [el("p", { cls: "pop-note", textContent: "Ничего не нашлось" })] : []));
    };
    search.addEventListener("input", draw);
    const pop = this.openPop(anchor, el("div", { cls: "pop-models" }, el("div", { cls: "pop-sep", textContent: "Модель чата" }), search, list,
      el("p", { cls: "pop-note", textContent: "Запасная модель и размышления — в «Настройках»." })), "left");
    if (!pop) return;
    draw();
    requestAnimationFrame(() => search.focus());
    if (!modelList) void api.cloudModels().then((r) => { modelList = r.ok ? r.value.models : []; if (this.pop === pop) draw(); });
  }
  private toggleCtxNote(anchor: HTMLElement) {
    const info = this.ctxNow();
    if (!info) return;
    this.openPop(anchor, el("div", { cls: "pop-ctx" },
      el("strong", { textContent: info.dropped ? `JUUNIBI видит ${info.kept} из ${info.total} сообщений` : `Занято ${info.percent}% памяти разговора` }),
      el("p", { textContent: info.dropped
        ? "Самые ранние сообщения этого чата уже не отправляются модели. Важное можно сохранить через «Запомнить» или начать новый чат."
        : "Чем длиннее чат и прикреплённые файлы, тем больше занято. Когда места не хватит, самые ранние сообщения перестанут учитываться." })));
  }
  private ctxNow() {
    const conv = this.chats.active();
    if (!conv?.messages.length) return null;
    const turns = conv.messages.filter((m) => m.role !== "note" && !!m.content.trim() && !m.error).map((m) => ({ content: m.role === "user" ? withFiles(m.content, m.files) : m.content }));
    return turns.length ? contextInfo(turns) : null;
  }

  // ---------- selection: «Спросить об этом», «Цитировать» ----------
  private setupSelection() {
    const show = () => {
      const s = window.getSelection();
      const text = s && !s.isCollapsed ? s.toString().trim() : "";
      const node = s?.anchorNode ? (s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode.parentElement) : null;
      if (!text || text.length < 2 || !node?.closest(".prose, .bubble") || !this.thread.contains(node)) { this.selPop.hidden = true; return; }
      const r = s!.getRangeAt(0).getBoundingClientRect(), m = this.main.getBoundingClientRect();
      const ask = el("button", { type: "button", cls: "sel-btn" }, icon("chat", 14), el("span", { textContent: "Спросить об этом" }));
      const quote = el("button", { type: "button", cls: "sel-btn" }, icon("corner", 14), el("span", { textContent: "Цитировать" }));
      const quoted = text.slice(0, 2000);
      ask.addEventListener("click", () => { this.selPop.hidden = true; s?.removeAllRanges(); void this.sendText("Объясни подробнее вот это место:\n" + quoted.split("\n").map((l) => "> " + l).join("\n")); });
      quote.addEventListener("click", () => { this.selPop.hidden = true; s?.removeAllRanges(); this.composer.quote(quoted); });
      this.selPop.replaceChildren(ask, quote);
      this.selPop.hidden = false;
      const w = this.selPop.offsetWidth;
      this.selPop.style.left = Math.round(Math.max(8, Math.min(m.width - w - 8, r.left - m.left + r.width / 2 - w / 2))) + "px";
      this.selPop.style.top = Math.round(Math.max(8, r.top - m.top - this.selPop.offsetHeight - 8)) + "px";
    };
    this.thread.addEventListener("mouseup", () => setTimeout(show, 0));
    this.thread.addEventListener("touchend", () => setTimeout(show, 250));
    this.thread.addEventListener("keyup", (e) => { if (e.shiftKey) show(); });
    document.addEventListener("selectionchange", () => { if (!this.selPop.hidden && window.getSelection()?.isCollapsed) this.selPop.hidden = true; });
  }

  // ---------- phone: swipe for the history, composer above the keyboard ----------
  private setupTouch() {
    let x0 = 0, y0 = 0, edge = false, onSide = false;
    this.root.addEventListener("touchstart", (e) => {
      const t = e.touches[0]; if (!t || !this.narrow()) return;
      x0 = t.clientX; y0 = t.clientY; edge = x0 < 28; onSide = this.root.classList.contains("side-open");
    }, { passive: true });
    this.root.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0]; if (!t || !this.narrow()) return;
      const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      if (dy > 60) return;
      if (edge && !onSide && dx > 70) this.root.classList.add("side-open");
      else if (onSide && dx < -70) this.root.classList.remove("side-open");
    }, { passive: true });
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      // iOS keeps the layout viewport under the keyboard; the window takes the visible height so the input stays in sight
      if (this.narrow() && !this.root.hidden) { this.root.style.setProperty("--vvh", Math.round(vv.height) + "px"); this.root.style.setProperty("--vvt", Math.round(vv.offsetTop) + "px"); }
      else { this.root.style.removeProperty("--vvh"); this.root.style.removeProperty("--vvt"); }
      if (this.stick) this.scrollDown();
    };
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
  }

  private setupDrops() {
    // drag & drop files anywhere in the window
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    this.root.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; this.drop.hidden = false; } });
    this.root.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    this.root.addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; this.drop.hidden = true; } });
    this.root.addEventListener("drop", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; this.drop.hidden = true; void this.composer.addFiles(e.dataTransfer!.files); });
    // files dragged from «Диск» (the chat window floats over the page): their text is attached
    const fromDisk = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DISK_DRAG);
    let diskDepth = 0;
    this.root.addEventListener("dragenter", (e) => { if (fromDisk(e)) { diskDepth++; this.drop.textContent = "Отпустите, чтобы прикрепить файлы с Диска"; this.drop.hidden = false; } });
    this.root.addEventListener("dragover", (e) => { if (fromDisk(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; } });
    this.root.addEventListener("dragleave", (e) => { if (fromDisk(e) && --diskDepth <= 0) { diskDepth = 0; this.drop.hidden = true; } });
    this.root.addEventListener("drop", (e) => {
      if (!fromDisk(e)) return;
      e.preventDefault(); e.stopPropagation(); diskDepth = 0; this.drop.hidden = true;
      this.drop.textContent = "Отпустите, чтобы прикрепить текстовые файлы";
      try { void this.attachDisk(JSON.parse(e.dataTransfer!.getData(DISK_DRAG)) as string[]); } catch { /* not ours */ }
    });
  }

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
    this.renderTitle(conv, busy, configured);
    // the banner below already says what is missing; the side panel only confirms a working link
    this.sideStatus.textContent = configured ? "На связи" : "";
    this.sideStatus.hidden = !configured;

    this.banner.hidden = configured || s.status === null;
    if (!this.banner.hidden && !this.banner.firstChild) {
      const go = el("button", { type: "button", textContent: "Открыть настройки" });
      go.addEventListener("click", () => this.onNavigate("settings"));
      this.banner.replaceChildren(icon("alert", 18), el("span", { textContent: "Чтобы JUUNIBI отвечала, добавьте ключ Cloud.ru." }), go);
    }
    this.renderContext();
    this.composer.loadDraft(conv?.id ?? null);
    this.composer.setState({ configured, busy });
    this.composer.setQueue(this.ctl.store.get().queue.filter((q) => q.convId === conv?.id));
    this.renderApprovals();
    this.renderSide(conv);
    if (conv?.id !== this.lastConv) { this.lastConv = conv?.id ?? null; this.stick = true; this.editingId = null; this.unseen = 0; this.seen = conv?.messages.length ?? 0; }
    this.renderThread(conv, busy);
    this.paintToBottom();
  }

  private titleSig = "";
  private renderTitle(conv: Conversation | undefined, busy: boolean, configured: boolean) {
    const s = app.get();
    const model = (s.assistantSettings?.chat.model || s.status?.model)?.split("/").pop() ?? "";
    const typing = busy && this.ctl.store.get().busyId === conv?.id;
    const lastMsg = conv?.messages[conv.messages.length - 1];
    const running = typing ? lastMsg?.steps?.find((st) => st.status === "running") : undefined;
    const sub = !configured ? (s.status ? "" : "подключение…") : running ? stepLabel(running.name) : typing ? "печатает" : "на связи";
    this.root.classList.toggle("generating", typing);
    const sig = JSON.stringify([sub, model, typing, configured, !!s.assistantSettings]);
    if (sig === this.titleSig) return;
    this.titleSig = sig;
    const modelBtn = configured && model && !typing && !running && s.assistantSettings
      ? el("button", { type: "button", cls: "model-btn", title: "Сменить модель", attrs: { "aria-haspopup": "listbox" } }, el("span", { textContent: model }), icon("chevron", 12)) : null;
    modelBtn?.addEventListener("click", (e) => { e.stopPropagation(); this.openModels(modelBtn); });
    this.titleEl.replaceChildren(characterAvatar(34, "head-av"), el("div", { cls: "chat-title-text" }, el("strong", { textContent: "JUUNIBI" }),
      el("span", { cls: "chat-sub", attrs: { "aria-live": "polite" } }, el("i", { cls: "dot " + (configured ? (typing ? "busy" : "on") : "off") }), sub,
        modelBtn ? el("span", { cls: "sub-sep", textContent: "·" }) : null, modelBtn,
        typing ? el("span", { cls: "dots", attrs: { "aria-hidden": "true" } }, el("i"), el("i"), el("i")) : null)));
  }

  /** The ring in the header and, once early messages are left out, a line above the input. */
  private renderContext() {
    const info = this.ctxNow();
    const sig = info ? `${info.percent}|${info.dropped}|${info.kept}` : "";
    if (this.ctxRing.dataset.sig === sig) return;
    this.ctxRing.dataset.sig = sig;
    this.ctxRing.hidden = !info || info.percent < 5;
    this.ctxBanner.hidden = !info?.dropped;
    if (!info) return;
    const tone = info.dropped ? "full" : info.percent >= 75 ? "warn" : "ok";
    this.ctxRing.className = "ctx-ring " + tone;
    this.ctxRing.title = info.dropped ? `Модель видит ${info.kept} из ${info.total} сообщений` : `Память разговора занята на ${info.percent}%`;
    this.ctxRing.setAttribute("aria-label", this.ctxRing.title);
    this.ctxRing.replaceChildren(ring(info.percent), el("span", { textContent: info.dropped ? "!" : String(info.percent) }));
    if (info.dropped) {
      const fresh = el("button", { type: "button", cls: "btn sm", textContent: "Новый чат" });
      fresh.addEventListener("click", () => this.newChat());
      this.ctxBanner.replaceChildren(icon("alert", 16), el("span", { textContent: `Чат длинный: JUUNIBI уже не видит ${info.dropped} первых сообщений.` }), fresh);
    }
  }

  private paintToBottom() {
    this.toBottom.classList.toggle("show", !this.stick);
    this.toBottom.classList.toggle("has-new", this.unseen > 0);
    const badge = this.unseen > 0 ? el("span", { cls: "to-bottom-n", textContent: this.unseen > 9 ? "9+" : String(this.unseen) }) : null;
    if ((this.toBottom.querySelector(".to-bottom-n")?.textContent ?? "") !== (badge?.textContent ?? "")) {
      this.toBottom.replaceChildren(icon("arrowDown", 18), ...(badge ? [badge] : []));
      this.toBottom.title = this.unseen ? `Новых сообщений: ${this.unseen}` : "Вниз";
      this.toBottom.setAttribute("aria-label", this.toBottom.title);
    }
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

  // ---------- history ----------
  private visibleChats(): Conversation[] {
    const q = this.search.value.trim().toLowerCase();
    return this.chats.store.get().items
      .filter((c) => this.area === "all" || c.area === this.area)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  }
  private setArea(a: AreaFilter) {
    this.area = a;
    try { localStorage.setItem(AREA_KEY, a); } catch { /* private mode */ }
    this.schedule();
  }
  private toggleSelecting() {
    this.selecting = this.selecting ? null : new Set();
    this.root.classList.toggle("selecting", !!this.selecting);
    this.sideList.dataset.sig = ""; this.schedule();
  }
  private renderSelectBar() {
    this.selectBar.hidden = !this.selecting;
    if (!this.selecting) return;
    const n = this.selecting.size;
    const del = el("button", { type: "button", cls: "btn sm danger", textContent: n ? `Удалить (${n})` : "Удалить", disabled: !n });
    del.addEventListener("click", () => {
      const ids = [...this.selecting!];
      if (!ids.length || !confirm(`Удалить выбранные чаты: ${ids.length}?`)) return;
      const busyId = this.ctl.store.get().busyId;
      if (busyId && ids.includes(busyId)) this.ctl.stop();
      this.chats.removeMany(ids);
      this.toggleSelecting();
      showToast(`Удалено чатов: ${ids.length}`, { ms: 2500 });
    });
    const all = el("button", { type: "button", cls: "btn sm", textContent: "Все" });
    all.addEventListener("click", () => { for (const c of this.visibleChats()) this.selecting!.add(c.id); this.sideList.dataset.sig = ""; this.schedule(); });
    const cancel = el("button", { type: "button", cls: "btn sm", textContent: "Отмена" });
    cancel.addEventListener("click", () => this.toggleSelecting());
    this.selectBar.replaceChildren(all, el("span", { cls: "grow" }), cancel, del);
  }

  private renderSide(active: Conversation | undefined) {
    const q = this.search.value.trim();
    const items = this.visibleChats();
    const counts = { all: this.chats.store.get().items.length, work: 0, personal: 0 };
    for (const c of this.chats.store.get().items) if (c.area) counts[c.area]++;
    const sig = JSON.stringify([items.map((c) => [c.id, c.title, c.updatedAt, c.messages.length, relTime(c.updatedAt), c.pinned, c.area]), active?.id, this.renamingId, q, this.ctl.store.get().busyId, this.area, counts, this.selecting ? [...this.selecting] : null]);
    if (this.sideList.dataset.sig === sig) return;
    this.sideList.dataset.sig = sig;
    this.areaBar.hidden = !counts.work && !counts.personal && this.area === "all";
    this.areaBar.replaceChildren(...AREAS.map(([id, label]) => {
      const b = el("button", { type: "button", cls: "side-area", attrs: { role: "radio", "aria-checked": String(this.area === id) } }, label, id !== "all" && counts[id] ? el("span", { cls: "n", textContent: String(counts[id]) }) : null);
      b.addEventListener("click", () => this.setArea(id));
      return b;
    }));
    this.renderSelectBar();
    if (!items.length) {
      this.sideList.replaceChildren(el("p", { cls: "side-empty", textContent: q ? "Ничего не найдено" : this.area !== "all" ? "Здесь пока нет чатов с этой меткой. Метку ставят в меню «⋯» чата." : "Здесь появится история чатов" }));
      return;
    }
    const out: Node[] = [];
    let last = "";
    for (const c of items) {
      const label = c.pinned ? "Закреплённые" : groupLabel(c.updatedAt);
      if (label !== last) { out.push(el("h3", { cls: "side-group", textContent: label })); last = label; }
      out.push(this.sideItem(c, c.id === active?.id, q));
    }
    this.sideList.replaceChildren(...out);
  }

  private sideItem(c: Conversation, active: boolean, q: string): HTMLElement {
    const row = el("div", { cls: "side-item" + (active ? " active" : "") + (c.pinned ? " pinned" : "") });
    if (this.renamingId === c.id) {
      const input = el("input", { type: "text", value: c.title, maxLength: 120, cls: "rename", attrs: { "aria-label": "Название чата" } });
      const done = (save: boolean) => { const id = this.renamingId; this.renamingId = null; if (save && id) this.chats.rename(id, input.value); this.sideList.dataset.sig = ""; this.schedule(); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); } });
      input.addEventListener("blur", () => { if (this.renamingId) done(true); });
      row.append(input);
      queueMicrotask(() => { input.focus(); input.select(); });
      return row;
    }
    const busy = this.ctl.store.get().busyId === c.id;
    // while searching, the line under the title shows the words found
    const hitMsg = q ? c.messages.find((m) => m.content.toLowerCase().includes(q.toLowerCase())) : undefined;
    const snip = hitMsg ? snippetAround(hitMsg.content, q) : null;
    const preview = snip ? el("span", { cls: "side-preview hit" }, snip.before, el("mark", { textContent: snip.hit }), snip.after)
      : previewOf(c.messages) ? el("span", { cls: "side-preview", textContent: previewOf(c.messages) }) : null;
    const tag = c.area ? el("i", { cls: "side-tag " + c.area, title: c.area === "work" ? "Работа" : "Личное" }) : null;
    const picked = this.selecting?.has(c.id) ?? false;
    const open = el("button", { type: "button", cls: "side-open-btn", title: c.title, attrs: active ? { "aria-current": "true" } : {} },
      el("span", { cls: "side-line" }, this.selecting ? el("input", { type: "checkbox", checked: picked, tabIndex: -1, cls: "side-check", attrs: { "aria-hidden": "true" } }) : null,
        tag, el("span", { cls: "side-title", textContent: c.title }),
        busy ? el("i", { cls: "spin sm" }) : el("span", { cls: "side-time", textContent: c.messages.length ? relTime(c.updatedAt) : "" })),
      preview);
    open.addEventListener("click", () => {
      if (this.selecting) { if (picked) this.selecting.delete(c.id); else this.selecting.add(c.id); this.sideList.dataset.sig = ""; this.schedule(); return; }
      this.chats.select(c.id); this.root.classList.remove("side-open");
      if (hitMsg) { this.jump = hitMsg.id; this.stick = false; } else this.stick = true;
      this.schedule();
    });
    row.append(open);
    if (!this.selecting) row.append(el("span", { cls: "side-actions" },
      iconButton("pin", c.pinned ? "Открепить" : "Закрепить сверху", (e) => { e.stopPropagation(); this.chats.setPinned(c.id, !c.pinned); }, "icon-btn sm" + (c.pinned ? " on" : "")),
      iconButton("edit", "Переименовать", (e) => { e.stopPropagation(); this.renamingId = c.id; this.sideList.dataset.sig = ""; this.schedule(); }, "icon-btn sm"),
      iconButton("trash", "Удалить чат", (e) => { e.stopPropagation(); if (confirm(`Удалить чат «${c.title}»?`)) { if (this.ctl.store.get().busyId === c.id) this.ctl.stop(); this.chats.remove(c.id); } }, "icon-btn sm")));
    return row;
  }

  // ---------- thread ----------
  /** Starter cards from the owner's day: today's to-dos, the day summary, the last chat, the newest file on the Disk. */
  private suggestions(): Suggestion[] {
    const s = app.get();
    const out: Suggestion[] = [];
    const b = s.brief;
    const today = (b?.today.length ?? 0) + (b?.due.length ?? 0);
    if (b && (today || b.openTodos.count)) out.push({ title: "Что у меня сегодня?", sub: today ? `Дел и напоминаний на сегодня: ${today}` : `Открытых дел: ${b.openTodos.count}`, icon: "list", text: "Что у меня сегодня по делам? Помоги расставить порядок." });
    out.push({ title: "Сводка дня", sub: "Напоминания, дела, что требует внимания", icon: "sun", text: BRIEF_PROMPT });
    const prev = this.chats.store.get().items.filter((c) => c.id !== this.chats.active()?.id && c.messages.some((m) => m.role === "user")).sort((x, y) => y.updatedAt - x.updatedAt)[0];
    if (prev) out.push({ title: "Вернуться к разговору", sub: `«${prev.title}» · ${relTime(prev.updatedAt)}`, icon: "chat", chat: prev.id });
    if (this.recentDisk) out.push({ title: "Разобрать файл с Диска", sub: this.recentDisk.name, icon: "folder", disk: this.recentDisk.id });
    for (const g of GENERIC) if (out.length < 4) out.push(g);
    return out.slice(0, 4);
  }
  private loadRecentDisk() {
    if (this.recentDisk !== undefined) return;
    this.recentDisk = null;
    void api.diskList().then((r) => {
      const f = r.ok ? r.value.files.find((x) => /\.(txt|md|csv|json|log|pdf|docx?|xlsx?|pptx?)$/i.test(x.name)) : undefined;
      if (f) { this.recentDisk = f; this.emptySig = ""; this.schedule(); }
    });
  }

  private renderThread(conv: Conversation | undefined, busy: boolean) {
    const msgs = conv?.messages ?? [];
    if (!msgs.length) {
      for (const r of this.rows.values()) r.root.remove();
      this.rows.clear();
      for (const sp of this.seps.values()) sp.remove();
      this.seps.clear();
      if (!this.root.hidden) this.loadRecentDisk();
      const sug = this.suggestions();
      const sig = JSON.stringify(sug);
      if (!this.empty || sig !== this.emptySig) {
        this.emptySig = sig;
        this.empty = el("div", { cls: "empty" }, characterAvatar(88, "hero-av"), el("h2", { textContent: greeting() + "!" }), el("p", { cls: "empty-sub", textContent: "Чем могу помочь?" }),
          el("div", { cls: "suggestions" }, ...sug.map((x) => el("button", { type: "button", cls: "suggest", attrs: { ...(x.text ? { "data-text": x.text } : {}), ...(x.chat ? { "data-chat": x.chat } : {}), ...(x.disk ? { "data-disk": x.disk } : {}) } },
            icon(x.icon, 20), el("span", { cls: "suggest-text" }, el("strong", { textContent: x.title }), el("span", { textContent: x.sub }))))),
          el("p", { cls: "muted hint-line", textContent: "«/» — команды, Ctrl+/ — справка. JUUNIBI может ошибаться: проверяйте важное." }));
        this.inner.replaceChildren(this.empty, this.approvals);
      }
      return;
    }
    if (this.empty) { this.empty.remove(); this.empty = null; this.emptySig = ""; }

    // messages that arrived while the owner was reading above: counted on the «Вниз» button
    if (msgs.length > this.seen && !this.stick) this.unseen += msgs.length - this.seen;
    this.seen = msgs.length;

    const wanted = new Set(msgs.map((m) => m.id));
    for (const [id, r] of this.rows) if (!wanted.has(id)) { r.root.remove(); this.rows.delete(id); }
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    const busyId = this.ctl.store.get().busyId;
    const order: HTMLElement[] = [];
    const usedSeps = new Set<string>();
    let prevTs = 0;
    let prevRole = "";
    for (const m of msgs) {
      if (!prevTs || !sameDay(prevTs, m.at)) {
        const key = String(new Date(m.at).setHours(0, 0, 0, 0));
        usedSeps.add(key);
        let sep = this.seps.get(key);
        if (!sep) { sep = el("div", { cls: "day-sep", attrs: { role: "separator" } }, el("span")); this.seps.set(key, sep); }
        const label = dayLabel(m.at);
        if (sep.firstChild!.textContent !== label) sep.firstChild!.textContent = label;
        order.push(sep);
        prevRole = "";
      }
      prevTs = m.at;
      const c = {
        convId: conv!.id, busy, editing: this.editingId === m.id, speaking: this.speakingId === m.id,
        streaming: busy && busyId === conv!.id && m.id === lastAssistant?.id && !m.turnId && !m.error && !m.stopped,
        isLast: m.id === lastAssistant?.id, cont: m.role !== "note" && m.role === prevRole, expanded: this.expanded.has(m.id),
      };
      prevRole = m.role;
      const sig = msgSignature(m, c);
      let row = this.rows.get(m.id);
      if (!row) { row = { root: el("article", { cls: `msg ${m.role}` }), sig: "" }; this.rows.set(m.id, row); }
      if (row.sig !== sig) {
        row.sig = sig;
        fillMessage(row.root, m, { ...c, ctl: this.ctl, onEdit: (id) => { this.editingId = id; this.schedule(); }, onCancelEdit: () => { this.editingId = null; this.schedule(); },
          onSaveEdit: (id, text) => { this.editingId = null; if (text.trim()) void this.ctl.edit(conv!.id, id, text); else this.schedule(); },
          onRemember: (t) => this.remember(conv!.id, t), onSpeak: (mm) => this.speak(mm),
          onExpand: (id, open) => { if (open) this.expanded.add(id); else this.expanded.delete(id); this.schedule(); },
          onAsk: (t) => void this.sendText(t), onSaveDisk: (mm) => this.saveAnswer(mm) });
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
    if (this.jump) {
      const target = this.rows.get(this.jump)?.root;
      this.jump = null;
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.classList.remove("hit"); void target.offsetWidth; target.classList.add("hit");
        setTimeout(() => target.classList.remove("hit"), 2400);
        return;
      }
    }
    if (this.stick) this.scrollDown();
  }
}

const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`; };

/** A small progress ring for the context indicator. */
function ring(percent: number): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 36 36"); svg.setAttribute("width", "26"); svg.setAttribute("height", "26"); svg.setAttribute("aria-hidden", "true");
  const c = (cls: string, dash: string) => { const e = document.createElementNS(NS, "circle"); e.setAttribute("cx", "18"); e.setAttribute("cy", "18"); e.setAttribute("r", "15"); e.setAttribute("class", cls); e.setAttribute("stroke-dasharray", dash); return e; };
  const len = 2 * Math.PI * 15;
  svg.append(c("ring-bg", ""), c("ring-fg", `${(len * Math.min(100, percent)) / 100} ${len}`));
  return svg;
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
