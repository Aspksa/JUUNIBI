import { api, type ModuleAction } from "../api";
import { el, icon, iconButton } from "../dom";
import type { AppState, Route } from "../state";
import { buildModules, filterModules, impactOf, moduleMeta, needsOf, shortUptime, statusShares, type ModFilter, type ModStatus, type ModView } from "./models";
import { addModulePanel, ago, assistantViewPanel, detailPanel, graphView, STATUS_TEXT, statusTag, toolsView } from "./modules-parts";
import { btn, chip, emptyState, pageHead } from "./kit";

type View = "tiles" | "graph" | "tools";
type Panel = null | "view" | "add";
/** Survives the page being re-created (route changes), so the search and the chosen view are not lost. */
const ui = { query: "", status: "all" as ModFilter, view: "tiles" as View, panel: null as Panel, selected: { name: null as string | null } };
const FILTERS: [ModFilter, string][] = [["all", "Все"], ["started", "Работают"], ["pending", "Ждут"], ["failed", "Сбой"], ["stopped", "Стоят"]];
const REFRESH_MS = 8000;
const DONE: Record<ModuleAction, string> = { stop: "Остановлен", start: "Запущен", restart: "Перезапущен", enable: "Включён", disable: "Выключен" };

export function modulesPage(s: AppState, go: (r: Route) => void): HTMLElement {
  let items: ModView[] = buildModules(s.modules).items;
  let loaded = s.modules.length > 0;
  let error = "";
  let updatedAt = loaded ? Date.now() : 0;
  let busy = false;
  let openName: string | null = null;
  let opener: HTMLElement | null = null;

  const health = el("section", { cls: "mod-health", attrs: { "aria-label": "Состояние модулей" } });
  const flash = el("p", { cls: "flash", attrs: { role: "status" } });
  const body = el("div", { cls: "mod-body" });
  const panelHost = el("div", { cls: "mod-panel" });
  const modal = el("div", { cls: "mod-modal", hidden: true });
  const root = el("div", { cls: "page" }, pageHead("modules", "Модули", "Состав JUUNIBI и состояние каждой части."));

  const say = (text: string, bad = false) => { flash.className = "flash" + (bad ? " bad" : ""); flash.textContent = text; };
  const find = (name: string | null) => items.find((m) => m.name === name);
  const controllable = (m: ModView) => m.kind === "builtin" && !m.core;

  async function doAct(m: ModView, action: ModuleAction) {
    if ((action === "stop" || action === "disable") && m.dependents.length &&
      !confirm(`Остановить «${m.title}»? Это затронет: ${m.dependents.join(", ")}. Они перейдут в состояние «Ждёт настройки».`)) return;
    busy = true; render();
    const r = await api.moduleAct(m.name, action);
    busy = false;
    if (r.ok) say(`${DONE[action]}: ${moduleMeta(m).short}.`); else say(r.error.message, true);
    await reload();
  }

  // ---------- header strip: how many modules are in which state ----------
  function renderHealth() {
    const counts = buildModules(items).counts;
    const shares = statusShares(counts);
    const bar = el("div", { cls: "mh-bar", attrs: { role: "img", "aria-label": shares.map((x) => `${STATUS_TEXT[x.status]}: ${x.count}`).join(", ") } },
      ...shares.map((x) => { const seg = el("i", { cls: `mh-seg ${x.status}`, title: `${STATUS_TEXT[x.status]}: ${x.count}` }); seg.style.flexGrow = String(x.count); return seg; }));
    const legend = el("div", { cls: "mh-legend" }, ...(["started", "pending", "failed", "stopped"] as ModStatus[]).map((st) =>
      el("span", { cls: `mh-item ${st}${counts[st] ? "" : " zero"}` }, el("i", { cls: "mh-dot" }), el("b", { textContent: String(counts[st]) }), STATUS_TEXT[st])));
    health.replaceChildren(
      el("div", { cls: "mh-top" }, el("strong", { textContent: `${items.length} модулей` }), el("span", { cls: "muted small", textContent: updatedAt ? "обновлено " + ago(new Date(updatedAt).toISOString()) : "" })),
      shares.length ? bar : el("div", { cls: "mh-bar empty" }), legend);
  }

  // ---------- tiles ----------
  const tiles = new Map<string, HTMLElement>();
  /** Hover or focus a tile: what it needs is outlined, what depends on it is marked, the rest steps back. */
  function relate(name: string | null) {
    const up = name ? new Set(needsOf(items, name)) : new Set<string>();
    const down = name ? new Set(impactOf(items, name)) : new Set<string>();
    for (const [n, t] of tiles) {
      t.classList.toggle("rel-up", up.has(n)); t.classList.toggle("rel-down", down.has(n));
      t.classList.toggle("dim", !!name && n !== name && !up.has(n) && !down.has(n));
    }
  }
  const tile = (m: ModView) => {
    const meta = moduleMeta(m);
    const stopped = m.status === "stopped";
    const quick: HTMLElement[] = controllable(m) ? [
      iconButton("refresh", "Перезапустить", (e) => { e.stopPropagation(); void doAct(m, "restart"); }, "icon-btn sm mt-q" + (busy || stopped ? " off" : "")),
      stopped ? iconButton("play", "Запустить", (e) => { e.stopPropagation(); void doAct(m, "start"); }, "icon-btn sm mt-q go")
        : iconButton("stop", "Остановить", (e) => { e.stopPropagation(); void doAct(m, "stop"); }, "icon-btn sm mt-q"),
    ] : [];
    const deps = m.deps.map((d) => find(d)).filter((x): x is ModView => !!x);
    const failedReason = m.status === "failed" ? (m.error || m.note) : "";
    const t = el("article", { cls: `mtile ${m.status}${m.kind === "manifest" ? " manifest" : ""}`, tabindex: 0,
      attrs: { role: "button", "aria-label": `${meta.short}: ${STATUS_TEXT[m.status]}. Открыть подробности`, "data-name": m.name } },
      el("div", { cls: "mt-top" },
        el("span", { cls: "mt-ic" }, icon(meta.icon, 24), el("i", { cls: "mt-dot", attrs: { "aria-hidden": "true" } })),
        el("span", { cls: "mt-badges" },
          m.errors24h ? el("span", { cls: "mt-badge bad", title: "Ошибок за сутки", textContent: `⚠ ${m.errors24h}` }) : null,
          m.assistantBlocked ? el("span", { cls: "mt-badge warn", title: "Помощнице закрыт доступ" }, icon("eye", 12)) : null,
          m.kind === "manifest" ? el("span", { cls: "mt-badge", textContent: "манифест" }) : null)),
      el("strong", { cls: "mt-title", textContent: meta.short, title: m.title }),
      el("span", { cls: "mt-status" }, STATUS_TEXT[m.status], m.status === "started" && m.uptimeSec ? el("span", { cls: "muted", textContent: " · " + shortUptime(m.uptimeSec) }) : null),
      el("p", { cls: "mt-note" + (failedReason ? " bad" : ""), textContent: failedReason || meta.what || m.note }),
      el("div", { cls: "mt-foot" },
        deps.length ? el("span", { cls: "mt-deps", title: "Зависит от: " + deps.map((d) => moduleMeta(d).short).join(", ") }, icon("link", 12), ...deps.map((d) => el("span", { cls: "mt-dep " + d.status, title: moduleMeta(d).short }, icon(moduleMeta(d).icon, 13))))
          : el("span", { cls: "mt-deps none muted", textContent: "самостоятельный" }),
        ...(quick.length ? [el("span", { cls: "mt-quick" }, ...quick)] : [])));
    const open = () => { opener = t; openModal(m.name); };
    t.addEventListener("click", open);
    t.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === t) { e.preventDefault(); open(); } });
    t.addEventListener("mouseenter", () => relate(m.name)); t.addEventListener("mouseleave", () => relate(null));
    t.addEventListener("focus", () => relate(m.name)); t.addEventListener("blur", () => relate(null));
    tiles.set(m.name, t);
    return t;
  };

  // ---------- details window ----------
  function openModal(name: string) { openName = name; renderModal(); }
  function closeModal() {
    openName = null; modal.hidden = true; modal.replaceChildren();
    document.removeEventListener("keydown", onKey, true);
    if (opener?.isConnected) opener.focus();
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && openName) { e.stopPropagation(); closeModal(); } };
  function renderModal() {
    const m = find(openName);
    if (!m) { if (openName) closeModal(); return; }
    const meta = moduleMeta(m);
    const nav = m.name === "assistant" && m.status === "pending" ? btn("Настроить", () => go("settings"), { small: true, primary: true })
      : m.name === "updater" ? btn("Открыть", () => go("update"), { small: true })
      : m.name === "memory" ? btn("Открыть", () => go("memory"), { small: true })
      : m.name === "brain" ? btn("Открыть", () => go("brain"), { small: true }) : null;
    const close = iconButton("x", "Закрыть", () => closeModal(), "icon-btn");
    const actions = el("div", { cls: "ms-actions" }, nav,
      ...(controllable(m) ? [
        btn("Перезапустить", () => void doAct(m, "restart"), { small: true, icon: "refresh", disabled: busy || m.status === "stopped" }),
        m.status === "stopped" ? btn("Запустить", () => void doAct(m, "start"), { small: true, primary: true, icon: "play", disabled: busy })
          : btn("Остановить", () => void doAct(m, "stop"), { small: true, icon: "stop", disabled: busy, title: "Остановить до перезапуска сервера" })] : []));
    const sheet = el("div", { cls: `mod-sheet ${m.status}`, attrs: { role: "dialog", "aria-modal": "true", "aria-label": m.title } },
      el("header", { cls: "ms-head" },
        el("span", { cls: "mt-ic big" }, icon(meta.icon, 28), el("i", { cls: "mt-dot" })),
        el("div", { cls: "ms-title" }, el("strong", { textContent: m.title }), el("span", {}, el("code", { textContent: m.name }), statusTag(m.status))),
        close),
      m.note ? el("p", { cls: "muted ms-note", textContent: m.note }) : null,
      m.status === "failed" ? el("p", { cls: "mod-error", textContent: "Причина: " + (m.error || m.note || "не указана") }) : null,
      actions,
      detailPanel(m, items, () => void reload()));
    modal.replaceChildren(sheet);
    modal.hidden = false;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    document.removeEventListener("keydown", onKey, true); document.addEventListener("keydown", onKey, true);
    if (!sheet.contains(document.activeElement)) close.focus();
  }

  // ---------- page ----------
  function render() {
    renderHealth();
    tiles.clear();
    let content: Node;
    if (error && !items.length) content = emptyState("alert", "Не удалось загрузить модули", error);
    else if (!loaded) content = el("p", { cls: "muted", textContent: "Загрузка…" });
    else if (ui.view === "graph") content = items.length ? graphView(items, ui.selected) : emptyState("modules", "Нет данных", "Сервер ещё не вернул список модулей.");
    else if (ui.view === "tools") content = toolsView();
    else {
      const shown = filterModules(items, ui.query, ui.status);
      content = !items.length ? emptyState("modules", "Нет данных", "Сервер ещё не вернул список модулей.")
        : !shown.length ? emptyState("search", "Ничего не найдено", "Измените запрос или сбросьте фильтр.", btn("Сбросить", () => { ui.query = ""; ui.status = "all"; search.value = ""; render(); }, { small: true }))
        : el("div", { cls: "mod-grid" }, ...shown.map(tile));
    }
    body.replaceChildren(content);
    panelHost.replaceChildren(...(ui.panel === "view" ? [assistantViewPanel()] : ui.panel === "add" ? [addModulePanel(() => { ui.panel = null; void reload(); render(); })] : []));
    chipsHost.replaceChildren(...FILTERS.map(([id, label]) => chip(label, id === "all" ? items.length : items.filter((m) => m.status === id).length, ui.status === id, () => { ui.status = id; render(); })));
    for (const [id, b] of viewBtns) b.setAttribute("aria-checked", String(ui.view === id));
    viewBtn.setAttribute("aria-pressed", String(ui.panel === "view")); addBtn.setAttribute("aria-pressed", String(ui.panel === "add"));
    filters.hidden = ui.view !== "tiles";
    if (openName) renderModal();
  }

  async function reload() {
    const r = await api.modules();
    if (r.ok) { items = buildModules(r.value).items; error = ""; loaded = true; updatedAt = Date.now(); } else { error = r.error.message; loaded = true; }
    render();
  }

  // ----- toolbar (built once, so typing in the search box is never interrupted by a refresh)
  const search = el("input", { type: "search", placeholder: "Поиск модуля", cls: "mod-search", attrs: { "aria-label": "Поиск модулей" } });
  search.value = ui.query;
  search.addEventListener("input", () => { ui.query = search.value; render(); });
  const chipsHost = el("div", { cls: "chips" });
  const filters = el("div", { cls: "mod-filters" }, chipsHost);
  const viewBtns = new Map<View, HTMLButtonElement>();
  const seg = el("div", { cls: "segmented", attrs: { role: "radiogroup", "aria-label": "Вид" } },
    ...([["tiles", "Плитки"], ["graph", "Граф"], ["tools", "Инструменты"]] as [View, string][]).map(([id, label]) => {
      const b = el("button", { type: "button", textContent: label, attrs: { role: "radio", "aria-checked": String(ui.view === id) } });
      b.addEventListener("click", () => { ui.view = id; render(); });
      viewBtns.set(id, b); return b;
    }));
  const refresh = btn("Обновить", async () => { refresh.disabled = true; await reload(); refresh.disabled = false; say(""); }, { small: true, icon: "refresh" });
  const viewBtn = btn("Для помощницы", () => { ui.panel = ui.panel === "view" ? null : "view"; render(); }, { small: true, icon: "eye", title: "Что именно видит помощница" });
  const addBtn = btn("Добавить", () => { ui.panel = ui.panel === "add" ? null : "add"; render(); }, { small: true, icon: "plus", title: "Добавить модуль-манифест" });
  root.append(health, el("div", { cls: "mod-toolbar" }, search, seg, el("div", { cls: "mod-tools-row" }, refresh, viewBtn, addBtn)), filters, flash, panelHost, body, modal);

  render();
  void reload();
  // Live refresh while the page is on screen; stops by itself when the page is replaced. Never while a window is open or being typed in.
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); document.removeEventListener("keydown", onKey, true); return; }
    if (!busy && !document.hidden && ui.view === "tiles" && !openName && !ui.panel && !(document.activeElement instanceof HTMLInputElement)) void reload();
  }, REFRESH_MS);
  return root;
}
