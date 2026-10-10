/**
 * The left menu: grouped items with counters, recent chats under «Беседа», the nearest reminder under «Дела»,
 * a collapsed (icons only) mode, the person's own order and hidden items, the JUUNIBI status at the bottom,
 * and on a phone a bottom bar with the first items. Logic lives in model.ts.
 */
import type { Chats } from "../chat/chats";
import type { ChatController } from "../chat/controller";
import { el, icon, iconButton, type IconName } from "../dom";
import { buildModules } from "../pages/models";
import { BRAIN_TILE_ROUTES, app, persistPrefs, type AppState, type Route, type Theme } from "../state";
import {
  arrange, badges, cleanPrefs, hotkeyLabel, loadPrefs, move, placeBefore, recentChats, savePrefs, todayLine, toggleHidden, visibleItems,
  UNHIDEABLE, type NavBadge, type NavId, type NavItem, type NavPrefs,
} from "./model";

export interface MenuDeps {
  chats: Chats; ctl: ChatController;
  go(r: Route): void; openChat(convId?: string): void;
  quickAdd(): void; palette(): void;
}

const isDark = (t: Theme): boolean => t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
const NARROW = matchMedia("(max-width: 860px)");
export const updateAvailable = (s: AppState): boolean => !!s.update?.latest && s.update.localVersion !== "не определена" && s.update.localVersion !== s.update.latest.sha;

export class Menu {
  readonly nav = el("nav", { cls: "nav", attrs: { "aria-label": "Разделы" } });
  readonly bottom = el("nav", { cls: "bottom-bar", attrs: { "aria-label": "Быстрые разделы" } });
  prefs: NavPrefs = loadPrefs();
  private editing = false;
  private dragId: NavId | null = null;
  private sig = "";

  constructor(private readonly d: MenuDeps) { NARROW.addEventListener("change", () => this.refresh()); }

  /** The phone drawer is always full width: icons only is for wide screens. */
  get collapsed(): boolean { return this.prefs.collapsed && !this.editing && !NARROW.matches; }
  setPrefs(p: NavPrefs) { this.prefs = p; savePrefs(p); this.refresh(); }
  toggleCollapsed() { this.setPrefs({ ...this.prefs, collapsed: !this.prefs.collapsed }); }
  startEdit() { this.editing = true; app.set({ navOpen: innerWidth <= 860 }); this.refresh(); (this.nav.querySelector(".nav-edit-done") as HTMLElement | null)?.focus(); }
  refresh() { this.sig = ""; this.render(app.get()); }

  private isActive(n: NavItem, s: AppState): boolean {
    if (n.id === "chat") return s.chatOpen;
    return (n.route === s.route || (n.id === "brain" && !!BRAIN_TILE_ROUTES[s.route]));
  }
  private counters(s: AppState) {
    return badges({ brief: s.brief, memory: s.memory, modulesFailed: buildModules(s.modules).counts.failed, updateAvailable: updateAvailable(s), unread: this.d.ctl.store.get().unread, approvals: s.approvals.length });
  }

  render(s: AppState) {
    if (this.dragId) return; // a re-render in the middle of a drag would drop it
    const b = this.counters(s);
    const today = todayLine(s.brief);
    const recent = recentChats(this.d.chats.store.get().items, 3).map((c) => ({ id: c.id, title: c.title }));
    const activeChat = this.d.chats.store.get().activeId;
    const sig = JSON.stringify([s.route, s.chatOpen, s.navOpen, s.theme, s.status, this.prefs, this.editing, b, today, recent, activeChat]);
    if (sig === this.sig) return;
    this.sig = sig;
    document.documentElement.classList.toggle("nav-collapsed", this.collapsed);
    this.nav.classList.toggle("collapsed", this.collapsed);
    this.nav.classList.toggle("editing", this.editing);
    this.nav.classList.toggle("open", s.navOpen);
    const keep = this.nav.querySelector<HTMLElement>(":focus")?.dataset.focus;
    this.nav.replaceChildren(...(this.editing ? this.editView() : this.mainView(s, b, today, recent, activeChat)));
    if (keep) this.nav.querySelector<HTMLElement>(`[data-focus="${keep}"]`)?.focus();
    this.renderBottom(s, b);
  }

  // ---------------------------------------------------------------- normal view

  private mainView(s: AppState, b: Partial<Record<NavId, NavBadge>>, today: ReturnType<typeof todayLine>, recent: { id: string; title: string }[], activeChat: string | null): Node[] {
    const c = this.collapsed;
    const collapse = iconButton(c ? "chevronRight" : "chevronLeft", c ? "Развернуть меню (Ctrl+B)" : "Свернуть меню (Ctrl+B)", () => this.toggleCollapsed(), "icon-btn sm nav-collapse");
    collapse.dataset.focus = "collapse";
    const add = el("button", { type: "button", cls: "nav-add", title: "Добавить дело, напоминание или заметку", attrs: { "aria-label": "Добавить дело, напоминание или заметку", "data-focus": "add" } }, icon("plus", 18), el("span", { cls: "nav-label", textContent: "Добавить" }));
    add.addEventListener("click", () => this.d.quickAdd());
    const search = el("button", { type: "button", cls: "nav-search", title: "Поиск и команды (Ctrl+K)", attrs: { "aria-label": "Поиск и команды (Ctrl+K)", "aria-keyshortcuts": "Control+K", "data-focus": "search" } }, icon("search", 18));
    search.addEventListener("click", () => this.d.palette());

    const groups = arrange(this.prefs).map((g) => el("div", { cls: "nav-group", attrs: { role: "group", "aria-label": g.group === "main" ? "Главное" : g.group === "brain" ? "Помощница" : "Система" } },
      ...g.items.flatMap((n) => {
        const out: Node[] = [this.itemNode(n, s, b[n.id])];
        if (c) return out;
        if (n.id === "chat" && recent.length) out.push(el("div", { cls: "nav-subs" }, ...recent.map((r) => {
          const x = el("button", { type: "button", cls: "nav-sub" + (s.chatOpen && r.id === activeChat ? " active" : ""), title: r.title, attrs: { "data-focus": "sub-" + r.id } }, el("span", { textContent: r.title }));
          x.addEventListener("click", () => this.d.openChat(r.id));
          return x;
        })));
        if (n.id === "tasks" && today) {
          const t = el("a", { href: "#/tasks", cls: "nav-today" + (today.due ? " due" : ""), title: today.text }, el("span", { cls: "nav-today-time", textContent: today.time }), el("span", { cls: "nav-today-text", textContent: today.text }));
          out.push(t);
        }
        return out;
      })));

    const dark = isDark(s.theme);
    const theme = iconButton(dark ? "sun" : "moon", dark ? "Включить светлую тему" : "Включить тёмную тему", () => { app.set({ theme: dark ? "light" : "dark" }); persistPrefs(app.get()); }, "icon-btn nav-theme");
    theme.dataset.focus = "theme";
    const edit = iconButton("edit", "Настроить меню: порядок и видимость пунктов", () => this.startEdit(), "icon-btn sm nav-edit");
    edit.dataset.focus = "edit";

    return [
      el("div", { cls: "nav-head" }, el("div", { cls: "brand", textContent: c ? "J" : "JUUNIBI" }), c ? null : edit, collapse),
      el("div", { cls: "nav-tools" }, add, search),
      ...groups,
      el("span", { cls: "grow" }),
      el("div", { cls: "nav-foot" }, this.statusPlate(s), theme),
    ];
  }

  private itemNode(n: NavItem, s: AppState, badge: NavBadge | undefined): HTMLElement {
    const active = this.isActive(n, s);
    const keys = hotkeyLabel(this.prefs, n.id);
    const tip = [n.label, badge?.title, keys].filter(Boolean).join(" · ");
    const kids = [el("span", { cls: "nav-ic" }, icon(n.icon, 18), badge ? el("i", { cls: "nav-pip " + badge.tone, attrs: { "aria-hidden": "true" } }) : null),
      el("span", { cls: "nav-label", textContent: n.label }),
      badge ? el("span", { cls: "nav-badge " + badge.tone, textContent: badge.count !== undefined ? String(badge.count > 99 ? "99+" : badge.count) : "", attrs: { "aria-label": badge.title } }) : null,
      keys ? el("span", { cls: "nav-hotkey", textContent: keys, attrs: { "aria-hidden": "true" } }) : null];
    const attrs: Record<string, string> = { "data-focus": "item-" + n.id };
    if (keys) attrs["aria-keyshortcuts"] = keys;
    if (n.id === "chat") {
      if (active) attrs["aria-pressed"] = "true";
      const b = el("button", { type: "button", cls: "nav-item" + (active ? " active" : ""), title: tip, attrs }, ...kids);
      b.addEventListener("click", () => this.d.openChat());
      return b;
    }
    if (active) attrs["aria-current"] = "page";
    return el("a", { href: "#/" + n.route, cls: "nav-item" + (active ? " active" : ""), title: tip, attrs }, ...kids);
  }

  private statusPlate(s: AppState): HTMLElement {
    const on = !!s.status?.assistant;
    const letter = el("span", { cls: "nav-me-letter", textContent: "J" });
    const img = el("img", { alt: "", cls: "nav-me-img", draggable: false });
    img.addEventListener("load", () => letter.remove(), { once: true });
    img.addEventListener("error", () => img.remove(), { once: true });
    img.src = "/avatar.webp";
    const line = s.status === null ? "проверяю…" : on ? ["на связи", s.status.model?.split("/").pop()].filter(Boolean).join(" · ") : "не подключена";
    const b = el("button", { type: "button", cls: "nav-me" + (on ? " on" : s.status ? " off" : ""), title: "JUUNIBI: " + line + ". Открыть настройки подключения", attrs: { "data-focus": "me" } },
      el("span", { cls: "nav-me-av" }, letter, img, el("i", { cls: "nav-me-dot", attrs: { "aria-hidden": "true" } })),
      el("span", { cls: "nav-me-text" }, el("strong", { textContent: "JUUNIBI" }), el("small", { textContent: line })));
    b.addEventListener("click", () => openConnection(this.d.go));
    return b;
  }

  // ---------------------------------------------------------------- edit mode

  private editView(): Node[] {
    const done = el("button", { type: "button", cls: "btn sm primary nav-edit-done", textContent: "Готово", attrs: { "data-focus": "done" } });
    done.addEventListener("click", () => { this.editing = false; this.refresh(); (this.nav.querySelector("[data-focus=edit]") as HTMLElement | null)?.focus(); });
    const reset = el("button", { type: "button", cls: "btn sm", textContent: "Как было" });
    reset.addEventListener("click", () => this.setPrefs({ ...cleanPrefs(null), collapsed: this.prefs.collapsed }));
    const groups = arrange(this.prefs, true).map((g) => {
      const box = el("div", { cls: "nav-group nav-edit-group" });
      for (const [i, n] of g.items.entries()) {
        const hidden = this.prefs.hidden.includes(n.id);
        const up = iconButton("arrowUp", `Выше: ${n.label}`, () => this.setPrefs(move(this.prefs, n.id, -1)), "icon-btn sm");
        const down = iconButton("arrowDown", `Ниже: ${n.label}`, () => this.setPrefs(move(this.prefs, n.id, 1)), "icon-btn sm");
        up.disabled = i === 0; down.disabled = i === g.items.length - 1;
        up.dataset.focus = "up-" + n.id; down.dataset.focus = "down-" + n.id;
        const eye = iconButton(hidden ? "eyeOff" : "eye", hidden ? `Показать: ${n.label}` : `Скрыть: ${n.label}`, () => this.setPrefs(toggleHidden(this.prefs, n.id)), "icon-btn sm");
        eye.dataset.focus = "eye-" + n.id;
        if (UNHIDEABLE.includes(n.id)) { eye.disabled = true; eye.title = "Настройки нельзя скрыть"; }
        const row = el("div", { cls: "nav-edit-row" + (hidden ? " is-hidden" : ""), draggable: true, attrs: { "data-id": n.id } },
          el("span", { cls: "nav-grip", attrs: { "aria-hidden": "true" } }, icon("grip", 16)), el("span", { cls: "grow nav-edit-label", textContent: n.label }), up, down, eye);
        this.dnd(row, n.id);
        box.append(row);
      }
      return box;
    });
    return [
      el("div", { cls: "nav-head" }, el("div", { cls: "brand", textContent: "Меню" }), done),
      el("p", { cls: "muted small nav-edit-hint", textContent: "Перетащите пункт или нажмите стрелки. Глаз прячет пункт из меню, Ctrl+K всё равно его найдёт." }),
      ...groups,
      el("span", { cls: "grow" }),
      el("div", { cls: "row nav-edit-foot" }, reset),
    ];
  }

  private dnd(row: HTMLElement, id: NavId) {
    row.addEventListener("dragstart", (e) => { this.dragId = id; row.classList.add("dragging"); e.dataTransfer?.setData("text/plain", id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragend", () => { this.dragId = null; row.classList.remove("dragging"); this.nav.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after")); this.refresh(); });
    row.addEventListener("dragover", (e) => {
      if (!this.dragId || this.dragId === id || row.parentElement !== this.nav.querySelector(`[data-id="${this.dragId}"]`)?.parentElement) return;
      e.preventDefault();
      const after = e.offsetY > row.offsetHeight / 2;
      row.classList.toggle("drop-after", after); row.classList.toggle("drop-before", !after);
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = this.dragId;
      if (!from || from === id) return;
      const after = row.classList.contains("drop-after");
      const next = after ? (row.nextElementSibling as HTMLElement | null)?.dataset.id as NavId | undefined : id;
      this.prefs = placeBefore(this.prefs, from, next ?? null);
      savePrefs(this.prefs);
    });
  }

  // ---------------------------------------------------------------- phone bottom bar

  private renderBottom(s: AppState, b: Partial<Record<NavId, NavBadge>>) {
    const items = visibleItems(this.prefs).filter((n) => n.id !== "settings").slice(0, 3);
    const cell = (label: string, ic: IconName, active: boolean, badge: NavBadge | undefined, run: () => void, href?: string) => {
      const kids = [el("span", { cls: "nav-ic" }, icon(ic, 22), badge ? el("i", { cls: "nav-pip " + badge.tone, attrs: { "aria-hidden": "true" } }) : null), el("span", { textContent: label })];
      const attrs: Record<string, string> = badge ? { "aria-label": `${label}: ${badge.title}` } : {};
      if (active) attrs[href ? "aria-current" : "aria-pressed"] = href ? "page" : "true";
      const x = href ? el("a", { href, cls: "bb-item" + (active ? " active" : ""), attrs }, ...kids) : el("button", { type: "button", cls: "bb-item" + (active ? " active" : ""), attrs }, ...kids);
      if (!href) x.addEventListener("click", run);
      return x;
    };
    this.bottom.replaceChildren(
      ...items.map((n) => cell(n.label, n.icon, this.isActive(n, s), b[n.id], () => this.d.openChat(), n.route ? "#/" + n.route : undefined)),
      cell("Добавить", "plus", false, undefined, () => this.d.quickAdd()),
      cell("Ещё", "menu", s.navOpen, undefined, () => app.set((x) => ({ navOpen: !x.navOpen }))),
    );
  }
}

/** Settings, scrolled to the «Подключение» card. */
export function openConnection(go: (r: Route) => void) {
  go("settings");
  let tries = 0;
  const find = () => {
    const card = document.getElementById("set-conn");
    if (card) card.scrollIntoView({ block: "start" });
    else if (++tries < 20) setTimeout(find, 50);
  };
  setTimeout(find, 30);
}
