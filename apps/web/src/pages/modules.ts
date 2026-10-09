import { api, type ModuleAction } from "../api";
import { el, icon } from "../dom";
import type { AppState, Route } from "../state";
import { buildModules, filterModules, type ModFilter, type ModView } from "./models";
import { addModulePanel, ago, assistantViewPanel, detailPanel, graphView, statusTag, TONE, toolsView } from "./modules-parts";
import { btn, chip, dot, emptyState, pageHead } from "./kit";

type View = "list" | "graph" | "tools";
type Panel = null | "view" | "add";
/** Survives the page being re-created (route changes), so the search and the open card are not lost. */
const ui = { query: "", status: "all" as ModFilter, view: "list" as View, panel: null as Panel, open: new Set<string>(), selected: { name: null as string | null } };
const FILTERS: [ModFilter, string][] = [["all", "Все"], ["started", "Работают"], ["pending", "Ждут"], ["failed", "Сбой"], ["stopped", "Остановлены"]];
const REFRESH_MS = 8000;

export function modulesPage(s: AppState, go: (r: Route) => void): HTMLElement {
  let items: ModView[] = buildModules(s.modules).items;
  let loaded = s.modules.length > 0;
  let error = "";
  let updatedAt = loaded ? Date.now() : 0;
  let busy = false;

  const summary = el("div", { cls: "mod-summary" });
  const flash = el("p", { cls: "flash", attrs: { role: "status" } });
  const body = el("div", { cls: "mod-body" });
  const panelHost = el("div", { cls: "mod-panel" });
  const stamp = el("span", { cls: "muted small mod-stamp" });
  const root = el("div", { cls: "page" }, pageHead("modules", "Модули", "Из чего состоит JUUNIBI, в каком состоянии каждая часть и что из этого доступно помощнице.", summary));

  const say = (text: string, bad = false) => { flash.className = "flash" + (bad ? " bad" : ""); flash.textContent = text; };
  const doAct = async (m: ModView, action: ModuleAction) => {
    if ((action === "stop" || action === "disable") && m.dependents.length &&
      !confirm(`Остановить «${m.title}»? Это затронет: ${m.dependents.join(", ")}. Они перейдут в состояние «Ждёт настройки».`)) return;
    busy = true; render();
    const r = await api.moduleAct(m.name, action);
    busy = false;
    if (r.ok) say(({ stop: "Остановлен", start: "Запущен", restart: "Перезапущен", enable: "Включён", disable: "Выключен" } as const)[action] + ": " + m.title + "."); else say(r.error.message, true);
    await reload();
  };

  const card = (m: ModView) => {
    const open = ui.open.has(m.name);
    const nav = m.name === "assistant" && m.status === "pending" ? btn("Настроить", () => go("settings"), { small: true, primary: true })
      : m.name === "updater" ? btn("Открыть", () => go("update"), { small: true })
      : m.name === "memory" ? btn("Открыть", () => go("memory"), { small: true })
      : m.name === "brain" ? btn("Открыть", () => go("brain"), { small: true }) : null;
    const controllable = m.kind === "builtin" && !m.core;
    const actions = el("div", { cls: "mod-actions" }, nav,
      controllable ? btn("Перезапустить", () => void doAct(m, "restart"), { small: true, icon: "refresh", disabled: busy || m.status === "stopped", title: "Заново запустить модуль" }) : null,
      controllable ? (m.status === "stopped"
        ? btn("Запустить", () => void doAct(m, "start"), { small: true, primary: true, disabled: busy })
        : btn("Остановить", () => void doAct(m, "stop"), { small: true, disabled: busy, title: "Остановить до перезапуска сервера" })) : null,
      btn(open ? "Скрыть" : "Подробнее", () => { if (open) ui.open.delete(m.name); else ui.open.add(m.name); render(); }, { small: true }));
    const li = el("li", { cls: `mod-card ${m.status}${open ? " open" : ""}${m.kind === "manifest" ? " manifest" : ""}`, attrs: { "data-depth": String(m.depth) } },
      el("div", { cls: "mod-row" },
        el("div", { cls: "mod-main" },
          el("div", { cls: "mod-title" }, dot(TONE[m.status]), el("strong", { textContent: m.title }), m.title !== m.name ? el("code", { textContent: m.name }) : null, statusTag(m.status),
            m.kind === "manifest" ? el("span", { cls: "tag", textContent: "манифест" }) : null,
            m.assistantBlocked ? el("span", { cls: "tag warn", textContent: "помощнице закрыто" }) : null),
          m.note ? el("p", { cls: "muted mod-note", textContent: m.note }) : null,
          m.status === "failed" ? el("p", { cls: "mod-error", textContent: "Причина: " + (m.error || m.note || "не указана") + (open ? "" : " — подробности и журнал в «Подробнее»") }) : null,
          m.deps.length ? el("div", { cls: "mod-deps" }, icon("chevron", 14), el("span", { cls: "muted", textContent: "зависит от" }), ...m.deps.map((x) => el("code", { textContent: x }))) : null),
        actions),
      open ? detailPanel(m, items, () => void reload()) : null);
    li.style.marginLeft = ui.view === "list" && !ui.query && ui.status === "all" ? m.depth * 12 + "px" : "0";
    return li;
  };

  const renderSummary = () => {
    const c = buildModules(items.map((m) => ({ ...m, status: m.status }))).counts;
    summary.replaceChildren(
      el("span", { cls: "mod-count ok" }, dot("ok"), `${c.started} работают`),
      ...(c.pending ? [el("span", { cls: "mod-count warn" }, dot("warn"), `${c.pending} ждут`)] : []),
      ...(c.stopped ? [el("span", { cls: "mod-count off" }, dot("off"), `${c.stopped} остановлены`)] : []),
      ...(c.failed ? [el("span", { cls: "mod-count bad" }, dot("bad"), `${c.failed} со сбоем`)] : []));
  };

  function render() {
    renderSummary();
    stamp.textContent = updatedAt ? "Обновлено " + ago(new Date(updatedAt).toISOString()) : "";
    let content: Node;
    if (error && !items.length) content = emptyState("alert", "Не удалось загрузить модули", error);
    else if (!loaded) content = el("p", { cls: "muted", textContent: "Загрузка…" });
    else if (ui.view === "graph") content = items.length ? graphView(items, ui.selected) : emptyState("modules", "Нет данных", "Сервер ещё не вернул список модулей.");
    else if (ui.view === "tools") content = toolsView();
    else {
      const shown = filterModules(items, ui.query, ui.status);
      content = !items.length ? emptyState("modules", "Нет данных", "Сервер ещё не вернул список модулей.")
        : !shown.length ? emptyState("search", "Ничего не найдено", "Измените запрос или сбросьте фильтр.", btn("Сбросить", () => { ui.query = ""; ui.status = "all"; search.value = ""; render(); }, { small: true }))
        : el("ul", { cls: "mod-list" }, ...shown.map(card));
    }
    body.replaceChildren(content);
    panelHost.replaceChildren(...(ui.panel === "view" ? [assistantViewPanel()] : ui.panel === "add" ? [addModulePanel(() => { ui.panel = null; void reload(); render(); })] : []));
    chipsHost.replaceChildren(...FILTERS.map(([id, label]) => chip(label, id === "all" ? items.length : items.filter((m) => m.status === id).length, ui.status === id, () => { ui.status = id; render(); })));
    for (const [id, b] of viewBtns) b.setAttribute("aria-checked", String(ui.view === id));
    viewBtn.setAttribute("aria-pressed", String(ui.panel === "view")); addBtn.setAttribute("aria-pressed", String(ui.panel === "add"));
    filters.hidden = ui.view !== "list";
  }

  async function reload() {
    const r = await api.modules();
    if (r.ok) { items = buildModules(r.value).items; error = ""; loaded = true; updatedAt = Date.now(); } else { error = r.error.message; loaded = true; }
    render();
  }

  // ----- toolbar (built once, so typing in the search box is never interrupted by a refresh)
  const search = el("input", { type: "search", placeholder: "Поиск по названию, заметке, зависимостям", cls: "mod-search", attrs: { "aria-label": "Поиск модулей" } });
  search.value = ui.query;
  search.addEventListener("input", () => { ui.query = search.value; render(); });
  const chipsHost = el("div", { cls: "chips" });
  const filters = el("div", { cls: "mod-filters" }, chipsHost);
  const viewBtns = new Map<View, HTMLButtonElement>();
  const seg = el("div", { cls: "segmented", attrs: { role: "radiogroup", "aria-label": "Вид" } },
    ...([["list", "Список"], ["graph", "Граф"], ["tools", "Инструменты"]] as [View, string][]).map(([id, label]) => {
      const b = el("button", { type: "button", textContent: label, attrs: { role: "radio", "aria-checked": String(ui.view === id) } });
      b.addEventListener("click", () => { ui.view = id; render(); });
      viewBtns.set(id, b); return b;
    }));
  const refresh = btn("Обновить", async () => { refresh.disabled = true; await reload(); refresh.disabled = false; say(""); }, { small: true, icon: "refresh" });
  const viewBtn = btn("Что видит помощница", () => { ui.panel = ui.panel === "view" ? null : "view"; render(); }, { small: true, icon: "eye" });
  const addBtn = btn("Добавить модуль", () => { ui.panel = ui.panel === "add" ? null : "add"; render(); }, { small: true, icon: "plus" });
  root.append(el("div", { cls: "mod-toolbar" }, search, seg, el("div", { cls: "mod-tools-row" }, refresh, viewBtn, addBtn, stamp)), filters, flash, panelHost, body);

  render();
  void reload();
  // Live refresh while the page is on screen; stops by itself when the page is replaced. Never while a card is being worked on.
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    if (!busy && !document.hidden && ui.view !== "tools" && !ui.open.size && !ui.panel && !(document.activeElement instanceof HTMLInputElement)) void reload();
  }, REFRESH_MS);
  return root;
}
