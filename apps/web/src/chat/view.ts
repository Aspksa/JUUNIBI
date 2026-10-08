import { el, icon, iconButton } from "../dom";
import { renderMarkdown } from "../markdown";
import { app, decideApproval, persistPrefs } from "../state";
import { groupLabel, type Chats, type ChatMsg, type Conversation } from "./chats";
import type { ChatController } from "./controller";

const SUGGESTIONS: { title: string; text: string }[] = [
  { title: "Что ты умеешь?", text: "Что ты умеешь? Расскажи коротко." },
  { title: "Покажи модули проекта", text: "Покажи, какие модули есть в проекте JUUNIBI и в каком они состоянии." },
  { title: "Есть ли обновления?", text: "Проверь, нужно ли обновить проект, и объясни, что для этого нужно сделать." },
  { title: "Запомни предпочтение", text: "Запомни: я предпочитаю тёмную тему и краткие ответы." },
];

interface Row { root: HTMLElement; sig: string }

/** ChatGPT-style chat window: conversation list, streaming thread with Markdown, composer. */
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
  private readonly input: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly titleEl: HTMLElement;
  private readonly maxBtn: HTMLButtonElement;
  private readonly rows = new Map<string, Row>();
  private empty: HTMLElement | null = null;
  private stick = true;
  private editingId: string | null = null;
  private renamingId: string | null = null;
  private frame = 0;
  private onClose: () => void = () => {};
  private onSettings: () => void = () => {};

  constructor(private readonly chats: Chats, private readonly ctl: ChatController) {
    // ---- sidebar
    const newBtn = el("button", { type: "button", cls: "new-chat" }, icon("plus", 18), el("span", { textContent: "Новый чат" }));
    newBtn.addEventListener("click", () => this.newChat());
    this.search = el("input", { type: "search", placeholder: "Поиск в чатах", cls: "side-search", attrs: { "aria-label": "Поиск в чатах" } });
    this.search.addEventListener("input", () => this.schedule());
    this.sideList = el("nav", { cls: "side-list", attrs: { "aria-label": "История чатов" } });
    this.side = el("aside", { cls: "chat-side" }, el("div", { cls: "side-top" }, newBtn, this.search), this.sideList);

    // ---- header
    const toggle = iconButton("sidebar", "Показать/скрыть историю", () => this.toggleSide());
    this.titleEl = el("div", { cls: "chat-title" });
    this.maxBtn = iconButton("maximize", "На весь экран", () => { app.set((s) => ({ chatMax: !s.chatMax })); persistPrefs(app.get()); });
    const head = el("header", { cls: "chat-head" }, toggle, this.titleEl, el("span", { cls: "grow" }),
      iconButton("plus", "Новый чат", () => this.newChat()), this.maxBtn, iconButton("x", "Закрыть чат", () => this.onClose()));

    // ---- thread
    this.inner = el("div", { cls: "thread-inner" });
    this.thread = el("div", { cls: "thread", attrs: { role: "log", "aria-live": "polite", "aria-label": "Сообщения" } }, this.inner);
    this.thread.addEventListener("scroll", () => {
      const near = this.thread.scrollHeight - this.thread.clientHeight - this.thread.scrollTop < 80;
      this.stick = near;
      this.toBottom.classList.toggle("show", !near);
    });
    this.toBottom = iconButton("arrowDown", "Вниз", () => { this.stick = true; this.scrollDown(true); }, "to-bottom");
    this.banner = el("div", { cls: "chat-banner", hidden: true });
    this.approvals = el("div", { cls: "approvals" });

    // ---- composer
    this.input = el("textarea", { rows: 1, placeholder: "Напишите сообщение JUUNIBI", cls: "composer-input", maxLength: 8000, attrs: { "aria-label": "Сообщение" } });
    this.input.addEventListener("input", () => { this.autosize(); this.schedule(); });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.submit(); }
    });
    this.sendBtn = el("button", { type: "submit", cls: "send-btn", title: "Отправить", attrs: { "aria-label": "Отправить" } }, icon("send", 18));
    const form = el("form", { cls: "composer" }, this.input, this.sendBtn);
    form.addEventListener("submit", (e) => { e.preventDefault(); if (this.ctl.busy) this.ctl.stop(); else this.submit(); });
    const composer = el("div", { cls: "composer-wrap" }, this.approvals, form,
      el("p", { cls: "disclaimer", textContent: "JUUNIBI может ошибаться. Проверяйте важную информацию." }));

    const main = el("section", { cls: "chat-main" }, head, this.banner, el("div", { cls: "thread-wrap" }, this.thread, this.toBottom), composer);
    this.root = el("div", { cls: "chat-window", hidden: true, attrs: { role: "dialog", "aria-label": "Чат с JUUNIBI" } }, this.side, el("div", { cls: "side-scrim" }), main);
    (this.root.querySelector(".side-scrim") as HTMLElement).addEventListener("click", () => this.root.classList.remove("side-open"));
    this.root.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "o" && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.newChat(); }
    });
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button.suggest") as HTMLButtonElement | null;
      if (b?.dataset.text) void this.sendText(b.dataset.text);
    });

    chats.store.subscribe(() => this.schedule());
    ctl.store.subscribe(() => this.schedule());
    app.subscribe(() => this.schedule());
    this.schedule();
  }

  setHandlers(onClose: () => void, onSettings: () => void) { this.onClose = onClose; this.onSettings = onSettings; }
  focus() { this.input.focus(); }
  /** Esc: first dismiss transient state (search text, edit box), otherwise ask the owner to close the window. */
  escape(): "handled" | "close" {
    if (this.editingId) { this.editingId = null; this.schedule(); return "handled"; }
    if (document.activeElement === this.search && this.search.value) { this.search.value = ""; this.schedule(); return "handled"; }
    if (this.root.classList.contains("side-open")) { this.root.classList.remove("side-open"); return "handled"; }
    return "close";
  }
  isSideOpenable() { return window.innerWidth < 760; }

  // ---------- actions
  private toggleSide() {
    if (this.isSideOpenable()) this.root.classList.toggle("side-open");
    else this.root.classList.toggle("side-hidden");
  }
  private newChat() { this.chats.create(); this.root.classList.remove("side-open"); this.editingId = null; this.stick = true; this.schedule(); this.input.focus(); }
  private submit() { const t = this.input.value; if (!t.trim()) return; this.input.value = ""; this.autosize(); void this.sendText(t); }
  private async sendText(text: string) {
    if (this.ctl.busy || !app.get().status?.assistant) return;
    const conv = this.chats.active() ?? this.chats.create();
    this.stick = true;
    await this.ctl.send(conv.id, text);
  }
  private autosize() { this.input.style.height = "auto"; this.input.style.height = Math.min(this.input.scrollHeight, 200) + "px"; }
  private scrollDown(smooth = false) { this.thread.scrollTo({ top: this.thread.scrollHeight, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" }); }

  // ---------- rendering
  private schedule() { if (this.frame) return; this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); }

  private render() {
    const s = app.get();
    const conv = this.chats.active();
    const busy = this.ctl.busy;
    const configured = !!s.status?.assistant;

    this.root.classList.toggle("max", s.chatMax);
    this.maxBtn.replaceChildren(icon(s.chatMax ? "minimize" : "maximize", 18));
    this.maxBtn.title = s.chatMax ? "Свернуть окно" : "На весь экран";
    this.maxBtn.setAttribute("aria-label", this.maxBtn.title);

    this.titleEl.replaceChildren(el("strong", { textContent: "JUUNIBI" }), ...(s.status?.model ? [el("span", { textContent: s.status.model.split("/").pop() ?? "" })] : []));

    // banner
    this.banner.hidden = configured || s.status === null;
    if (!this.banner.hidden && !this.banner.firstChild) {
      const go = el("button", { type: "button", textContent: "Открыть настройки" });
      go.addEventListener("click", () => this.onSettings());
      this.banner.replaceChildren(icon("alert", 18), el("span", { textContent: "Ключ Cloud.ru не задан — помощник пока не может отвечать." }), go);
    }

    // composer
    this.input.disabled = !configured;
    this.input.placeholder = configured ? "Напишите сообщение JUUNIBI" : "Сначала добавьте ключ Cloud.ru в настройках";
    this.sendBtn.replaceChildren(icon(busy ? "stop" : "send", 18));
    this.sendBtn.title = busy ? "Остановить" : "Отправить";
    this.sendBtn.setAttribute("aria-label", this.sendBtn.title);
    this.sendBtn.classList.toggle("stop", busy);
    this.sendBtn.disabled = !configured || (!busy && !this.input.value.trim());

    this.renderApprovals();
    this.renderSide(conv);
    this.renderThread(conv, busy);
  }

  private renderApprovals() {
    const list = app.get().approvals;
    const key = JSON.stringify(list.map((a) => a.id));
    if (this.approvals.dataset.key === key) return;
    this.approvals.dataset.key = key;
    this.approvals.replaceChildren(...list.map((a) => {
      const card = el("div", { cls: "approval", attrs: { role: "group" } },
        el("strong", { textContent: `Нужно разрешение: ${a.tool} (${a.risk})` }),
        el("pre", { textContent: JSON.stringify(a.args, null, 2).slice(0, 1500) }),
        el("div", { cls: "row" },
          (() => { const b = el("button", { type: "button", cls: "btn", textContent: "Отклонить" }); b.addEventListener("click", () => void decideApproval(a.id, false)); return b; })(),
          (() => { const b = el("button", { type: "button", cls: "btn primary", textContent: "Разрешить" }); b.addEventListener("click", () => void decideApproval(a.id, true)); return b; })()));
      return card;
    }));
  }

  private renderSide(active: Conversation | undefined) {
    const q = this.search.value.trim().toLowerCase();
    const items = this.chats.store.get().items
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const sig = JSON.stringify([items.map((c) => [c.id, c.title, c.updatedAt]), active?.id, this.renamingId, q]);
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
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") { e.stopPropagation(); done(false); } });
      input.addEventListener("blur", () => { if (this.renamingId) done(true); });
      row.append(input);
      queueMicrotask(() => { input.focus(); input.select(); });
      return row;
    }
    const open = el("button", { type: "button", cls: "side-open-btn", title: c.title, textContent: c.title, attrs: active ? { "aria-current": "true" } : {} });
    open.addEventListener("click", () => { this.chats.select(c.id); this.stick = true; this.root.classList.remove("side-open"); });
    const actions = el("span", { cls: "side-actions" },
      iconButton("edit", "Переименовать", (e) => { e.stopPropagation(); this.renamingId = c.id; this.sideList.dataset.sig = ""; this.schedule(); }, "icon-btn sm"),
      iconButton("trash", "Удалить чат", (e) => { e.stopPropagation(); if (confirm(`Удалить чат «${c.title}»?`)) { if (this.ctl.store.get().busyId === c.id) this.ctl.stop(); this.chats.remove(c.id); } }, "icon-btn sm"));
    row.append(open, actions);
    return row;
  }

  private renderThread(conv: Conversation | undefined, busy: boolean) {
    const msgs = conv?.messages ?? [];
    if (!msgs.length) {
      for (const r of this.rows.values()) r.root.remove();
      this.rows.clear();
      if (!this.empty) {
        this.empty = el("div", { cls: "empty" },
          el("h2", { textContent: "Чем могу помочь?" }),
          el("div", { cls: "suggestions" }, ...SUGGESTIONS.map((s) => el("button", { type: "button", cls: "suggest", textContent: s.title, attrs: { "data-text": s.text } }))));
        this.inner.replaceChildren(this.empty);
      }
      return;
    }
    if (this.empty) { this.empty.remove(); this.empty = null; }

    const wanted = new Set(msgs.map((m) => m.id));
    for (const [id, r] of this.rows) if (!wanted.has(id)) { r.root.remove(); this.rows.delete(id); }
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    let prev: HTMLElement | null = null;
    for (const m of msgs) {
      const streaming = busy && this.ctl.store.get().busyId === conv!.id && m.id === lastAssistant?.id && !m.turnId && !m.error && !m.stopped;
      const isLast = m.id === lastAssistant?.id;
      const sig = [m.content.length, m.rating, m.error, m.stopped, m.turnId, streaming, isLast, busy, m.scene?.action, this.editingId === m.id, m.tools?.join()].join("|");
      let row = this.rows.get(m.id);
      if (!row) { row = { root: el("article", { cls: `msg ${m.role}` }), sig: "" }; this.rows.set(m.id, row); }
      if (row.sig !== sig) { row.sig = sig; this.fill(row.root, m, { streaming, isLast, busy, convId: conv!.id }); }
      if (row.root.parentElement !== this.inner || row.root.previousElementSibling !== prev) this.inner.insertBefore(row.root, prev ? prev.nextSibling : this.inner.firstChild);
      prev = row.root;
    }
    if (this.stick) this.scrollDown();
  }

  private fill(root: HTMLElement, m: ChatMsg, o: { streaming: boolean; isLast: boolean; busy: boolean; convId: string }) {
    root.replaceChildren();
    if (m.role === "user") { this.fillUser(root, m, o); return; }
    if (m.scene) {
      root.append(el("div", { cls: "scene" }, el("em", { textContent: m.scene.action }), ...(m.scene.phrase ? [el("p", { textContent: "«" + m.scene.phrase + "»" })] : [])));
    }
    const prose = el("div", { cls: "prose" + (o.streaming ? " streaming" : "") });
    if (m.content) prose.append(renderMarkdown(m.content));
    else if (o.streaming) prose.append(el("span", { cls: "typing", attrs: { "aria-label": "JUUNIBI печатает" } }, el("i"), el("i"), el("i")));
    root.append(prose);
    if (m.stopped && !m.error?.trim()) root.append(el("p", { cls: "note", textContent: "Генерация остановлена." }));
    if (m.error && !m.stopped) {
      const retry = el("button", { type: "button", cls: "btn", textContent: "Повторить" });
      retry.addEventListener("click", () => { void this.ctl.regenerate(o.convId); });
      root.append(el("div", { cls: "error-box", attrs: { role: "alert" } }, icon("alert", 16), el("span", { textContent: m.error }), o.isLast && !o.busy ? retry : null));
    }
    if (m.tools?.length) root.append(el("p", { cls: "note", textContent: "Использованы инструменты: " + [...new Set(m.tools)].join(", ") }));
    if (o.streaming) return;
    const actions = el("div", { cls: "msg-actions" });
    if (m.content) {
      const copy = iconButton("copy", "Копировать", async () => {
        try { await navigator.clipboard.writeText(m.content); copy.replaceChildren(icon("check", 16)); setTimeout(() => copy.replaceChildren(icon("copy", 16)), 1500); } catch { copy.title = "Не удалось скопировать"; }
      }, "icon-btn sm");
      actions.append(copy);
      if (m.turnId) {
        for (const [name, label, r] of [["up", "Хороший ответ", 1], ["down", "Плохой ответ", -1]] as const) {
          const b = iconButton(name, label, () => void this.ctl.rate(o.convId, m, r), "icon-btn sm");
          b.setAttribute("aria-pressed", String(m.rating === r));
          actions.append(b);
        }
      }
    }
    if (o.isLast && !o.busy) actions.append(iconButton("refresh", "Сгенерировать заново", () => void this.ctl.regenerate(o.convId), "icon-btn sm"));
    if (actions.childElementCount) root.append(actions);
  }

  private fillUser(root: HTMLElement, m: ChatMsg, o: { busy: boolean; convId: string }) {
    if (this.editingId === m.id) {
      const ta = el("textarea", { value: m.content, cls: "edit-input", rows: 3, maxLength: 8000, attrs: { "aria-label": "Редактирование сообщения" } });
      const cancel = el("button", { type: "button", cls: "btn", textContent: "Отмена" });
      const save = el("button", { type: "button", cls: "btn primary", textContent: "Отправить" });
      cancel.addEventListener("click", () => { this.editingId = null; this.schedule(); });
      save.addEventListener("click", () => { const t = ta.value; this.editingId = null; if (t.trim()) void this.ctl.edit(o.convId, m.id, t); else this.schedule(); });
      ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); cancel.click(); } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save.click(); });
      root.append(el("div", { cls: "edit-box" }, ta, el("div", { cls: "row" }, cancel, save)));
      queueMicrotask(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
      return;
    }
    root.append(el("div", { cls: "bubble", textContent: m.content }));
    const actions = el("div", { cls: "msg-actions" });
    const copy = iconButton("copy", "Копировать", async () => { try { await navigator.clipboard.writeText(m.content); copy.replaceChildren(icon("check", 16)); setTimeout(() => copy.replaceChildren(icon("copy", 16)), 1500); } catch { /* ignore */ } }, "icon-btn sm");
    actions.append(copy);
    if (!o.busy) actions.append(iconButton("edit", "Изменить сообщение", () => { this.editingId = m.id; this.schedule(); }, "icon-btn sm"));
    root.append(actions);
  }
}
