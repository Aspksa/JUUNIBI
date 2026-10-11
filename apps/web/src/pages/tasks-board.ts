/**
 * «Дела» as a board: «Надо сделать → В работе → Жду ответа → Готово».
 * Cards are ticked, moved with arrows, dragged to a place, edited in place; columns take new to-dos;
 * «Жду ответа» asks whom and when to remind; on a narrow screen the columns become tabs.
 */
import { api, type Area, type Note, type ProjectMeta } from "../api";
import { el, icon, iconButton } from "../dom";
import { btn, chip } from "./kit";
import { parseQuick, type QuickParsed } from "./quick-entry";
import { BOARD_COLS, BUCKET_LABEL, STATUS_LABEL, areaOf, boardColumns, boardFilter, boardLanes, columnOf, daysWord, isDateOnly, markParts, meetingSpan, placeAt, sideColumn, statusDays, todoBuckets,
  type AreaFilter, type BoardCol, type LaneMode } from "./tasks-model";

type Result = { ok: boolean; error?: { message: string } };
export interface BoardDeps {
  /** The to-dos to show (deleted ones and other projects already left out). */
  notes(): Note[];
  /** Every note, for the steps of a card. */
  all(): Note[];
  projects(): ProjectMeta[];
  goalTitle(id?: string): string | undefined;
  query(): string;
  area(): AreaFilter;
  act(run: () => Promise<Result>, ok?: string, undo?: () => void): Promise<boolean>;
  setDone(id: string, done: boolean, node?: HTMLElement | null): void;
  remove(n: Note): void;
  /** Opens the full editor (date, project, repeat…) in the list. */
  openEditor(n: Note): void;
  saveQuick(p: QuickParsed, area?: Area): Promise<{ ok: boolean; value?: { id: string }; error?: { message: string } }>;
  when(iso: string, dateOnly: boolean): string;
  dot(color?: string): HTMLElement;
  selected: Set<string>;
  onSelect(): void;
  redraw(): void;
  page(): HTMLElement;
}

/** Remembered in the browser: filters, rows, compact cards, the folded «Готово», the open tab on a phone. */
const PREF = "juunibi.tasks.board";
const B = { important: false, week: false, lanes: "none" as LaneMode, compact: false, doneFolded: false, tab: "todo" as BoardCol };
try { const saved: unknown = JSON.parse(localStorage.getItem(PREF) ?? "{}"); if (saved && typeof saved === "object" && !Array.isArray(saved)) { const prefs = saved as Record<string, unknown>; for (const key of ["important", "week", "compact", "doneFolded"] as const) if (typeof prefs[key] === "boolean") B[key] = prefs[key]; if (typeof prefs.lanes === "string" && ["none", "project", "area"].includes(prefs.lanes)) B.lanes = prefs.lanes as LaneMode; if (typeof prefs.tab === "string" && BOARD_COLS.includes(prefs.tab as BoardCol)) B.tab = prefs.tab as BoardCol; } } catch { /* private mode or a bad value */ }
if (!BOARD_COLS.includes(B.tab)) B.tab = "todo";
const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify(B)); } catch { /* private mode */ } };
/** A column shows this many cards until «ещё» is pressed. */
const COL_LIMIT = 8;
/** More than this in «В работе» gets a gentle warning. */
export const WIP_LIMIT = 3;
const DRAG_TYPE = "text/x-juunibi-task";
const HINT: Record<BoardCol, string> = { todo: "Добавьте дело или перетащите сюда", doing: "Перетащите сюда то, чем заняты", waiting: "Дела, где вы ждёте ответа от кого-то", done: "Сделанное за неделю" };

export function taskBoard(d: BoardDeps): () => HTMLElement {
  let editingId: string | null = null;
  let askWait: string | null = null;
  let adding: string | null = null;
  let focusId: string | null = null;
  /** What is typed in an open field survives a redraw after the server answers. */
  const draft = { edit: "", wait: "", add: "" };
  /** A field just opened takes the keyboard once; later redraws leave the focus where it is. */
  let focusField = false;
  /** The open field that had the keyboard before this redraw. */
  let keepField: "wait" | "add" | null = null;
  const openSteps = new Set<string>();
  const showAll = new Set<string>();
  let dragId: string | null = null;
  const ghost = el("div", { cls: "tasks-card-ghost", attrs: { "aria-hidden": "true" } });
  const find = (id: string | null | undefined) => (id ? d.all().find((x) => x.id === id) : undefined);

  /** Moves a card to a column (and a place in it, and a row of the board), at once on the screen; «Отменить» puts it back. */
  const moveCard = (n: Note, col: BoardCol, o: { order?: string[]; lane?: string } = {}) => {
    const from = columnOf(n);
    const prev = { status: n.status, waitingFor: n.waitingFor, followUpAt: n.followUpAt, project: n.project, area: n.area };
    const laneField = o.lane === undefined || B.lanes === "none" ? null : B.lanes === "project" ? { project: o.lane || null } : { area: (o.lane || null) as Area | null };
    const laneChanged = !!laneField && (B.lanes === "project" ? (n.project ?? "") !== (o.lane ?? "") : areaOf(n, d.projects()) !== o.lane);
    if (col === "done" && from !== "done") { focusId = n.id; d.setDone(n.id, true); return; }
    if (from === col && !o.order && !laneChanged) return;
    // on the screen first
    if (from === "done") { n.done = false; delete n.completedAt; }
    if (col === "todo") delete n.status; else if (col !== "done") n.status = col;
    if (col === "waiting" && from !== "waiting") { askWait = n.id; focusField = true; }
    focusId = n.id;
    d.redraw();
    const undo = () => void d.act(async () => {
      if (from === "done") return api.setTodoDone(n.id, true);
      if (col === "done") { const r = await api.setTodoDone(n.id, false); if (!r.ok) return r; }
      return api.updateTask(n.id, { status: prev.status ?? "todo", ...(prev.status === "waiting" ? { waitingFor: prev.waitingFor ?? null, followUpAt: prev.followUpAt ?? null } : {}),
        ...(laneChanged ? (B.lanes === "project" ? { project: prev.project ?? null } : { area: prev.area ?? null }) : {}) });
    }, "Возвращено");
    void d.act(async () => {
      if (from === "done") { const r = await api.setTodoDone(n.id, false); if (!r.ok) return r; }
      if (from !== col || laneChanged) { const r = await api.updateTask(n.id, { ...(from !== col ? { status: col } : {}), ...(laneChanged ? laneField : {}) } as Parameters<typeof api.updateTask>[1]); if (!r.ok) return r; }
      return o.order ? api.orderTasks(o.order) : { ok: true };
    }, from !== col ? STATUS_LABEL[col] + ": " + n.text : laneChanged ? "Перенесено" : undefined, from !== col || laneChanged ? undo : undefined);
  };

  // ---------- a card ----------
  const meta = (...parts: (string | HTMLElement | null | false | undefined)[]) => {
    const kids = parts.filter((x): x is string | HTMLElement => !!x);
    return kids.length ? el("span", { cls: "tasks-meta" }, ...kids.map((k) => (typeof k === "string" ? el("span", { textContent: k }) : k))) : null;
  };
  const textEditor = (n: Note) => {
    const input = el("input", { type: "text", maxLength: 500, value: draft.edit || n.text, cls: "mem-input tasks-card-input", attrs: { "aria-label": "Текст дела" } });
    input.addEventListener("input", () => { draft.edit = input.value; });
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true; editingId = null; focusId = n.id; draft.edit = "";
      const t = input.value.trim();
      if (save && t && t !== n.text) { const old = n.text; n.text = t; d.redraw(); void d.act(() => api.editNote(n.id, t), "Сохранено", () => void d.act(() => api.editNote(n.id, old), "Возвращено")); }
      else d.redraw();
    };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); } });
    input.addEventListener("blur", () => { if (input.isConnected) finish(true); });
    queueMicrotask(() => { input.focus(); if (!draft.edit) input.select(); });
    return input;
  };
  /** «Кого ждёте?» and «Когда напомнить?» right on a card that came to «Жду ответа». */
  const waitForm = (n: Note) => {
    const who = el("input", { type: "text", maxLength: 80, value: draft.wait || n.waitingFor || "", cls: "mem-input", placeholder: "Кого ждёте? Например, Иван", attrs: { "aria-label": "От кого жду ответа" } });
    who.addEventListener("input", () => { draft.wait = who.value; });
    const close = () => { askWait = null; focusId = n.id; draft.wait = ""; d.redraw(); };
    const save = (days: number | null) => {
      const name = who.value.trim();
      const at = days === null ? null : (() => { const x = new Date(); x.setDate(x.getDate() + days); x.setHours(10, 0, 0, 0); return x.toISOString(); })();
      askWait = null; focusId = n.id; draft.wait = "";
      if (name) n.waitingFor = name; else delete n.waitingFor;
      if (at) n.followUpAt = at; else delete n.followUpAt;
      d.redraw();
      void d.act(() => api.updateTask(n.id, { status: "waiting", waitingFor: name || null, followUpAt: at }), at ? "Спрошу снова " + d.when(at, false) : name ? "Жду ответа: " + name : undefined);
    };
    who.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); save(1); } else if (e.key === "Escape") { e.preventDefault(); close(); } });
    if (focusField || keepField === "wait") { focusField = false; queueMicrotask(() => who.focus()); }
    return el("div", { cls: "tasks-card-wait", attrs: { role: "group", "aria-label": "Жду ответа" } }, who,
      el("small", { cls: "muted", textContent: "Когда напомнить спросить снова?" }),
      el("div", { cls: "tasks-card-wait-row" },
        btn("Завтра", () => save(1), { small: true, primary: true }), btn("Через 3 дня", () => save(3), { small: true }), btn("Через неделю", () => save(7), { small: true }),
        btn("Не напоминать", () => save(null), { small: true })));
  };
  const card = (n: Note, laneKey: string): HTMLElement => {
    const col = columnOf(n);
    const kids = d.all().filter((k) => k.parentId === n.id && !k.auto);
    const overdue = !n.done && !!n.dueAt && Date.parse(n.dueAt) < Date.now();
    const goal = d.goalTitle(n.project);
    const waitDays = col === "waiting" ? statusDays(n) : null;
    const box = el("input", { type: "checkbox", checked: n.done, attrs: { "aria-label": (n.done ? "Вернуть в работу: " : "Сделано: ") + n.text } });
    const c = el("article", { cls: "tasks-card" + (n.priority === "high" && !n.done ? " important" : "") + (n.done ? " done" : "") + (d.selected.has(n.id) ? " picked" : "") + (waitDays !== null && waitDays >= 3 ? " stale" : ""),
      attrs: { "data-id": n.id, "data-col": col, "data-lane": laneKey, tabindex: "0", "aria-label": n.text } });
    box.addEventListener("change", () => { focusId = n.id; d.setDone(n.id, box.checked, c); });
    const left = sideColumn(col, -1), right = sideColumn(col, 1);
    const arrow = (to: BoardCol | null, dir: "chevronLeft" | "chevronRight") => to
      ? iconButton(dir, (to === "done" ? "Готово" : "В «" + STATUS_LABEL[to] + "»") + " (" + (dir === "chevronLeft" ? "←" : "→") + ")", () => moveCard(n, to), "icon-btn sm tasks-card-move")
      : null;
    const text = editingId === n.id ? textEditor(n)
      : el("span", { cls: "grow tasks-card-text", title: n.done ? "" : "Двойной щелчок — изменить" }, ...markParts(n.text, d.query()).map(([x, hit]) => (hit ? el("mark", { textContent: x }) : x)));
    if (!n.done && editingId !== n.id) text.addEventListener("dblclick", () => { editingId = n.id; d.redraw(); });
    const stepsOpen = openSteps.has(n.id);
    const stepsBtn = kids.length && !B.compact ? el("button", { type: "button", cls: "tasks-card-steps-btn", attrs: { "aria-expanded": String(stepsOpen) } },
      icon(stepsOpen ? "chevron" : "chevronRight", 14), `шаги ${kids.filter((k) => k.done).length}/${kids.length}`) : null;
    stepsBtn?.addEventListener("click", () => { if (openSteps.has(n.id)) openSteps.delete(n.id); else openSteps.add(n.id); focusId = n.id; d.redraw(); });
    const due = n.meeting && n.dueAt ? el("span", { cls: "tasks-meet" + (overdue ? " late" : ""), textContent: "встреча " + d.when(n.dueAt, true) + " " + meetingSpan(n) })
      : n.dueAt && !n.done ? el("span", { cls: overdue ? "late" : "", textContent: d.when(n.dueAt, isDateOnly(n.dueAt)) }) : null;
    c.append(...[
      el("div", { cls: "tasks-card-top" }, box,
        n.project && !goal ? d.dot(d.projects().find((p) => p.name.toLowerCase() === n.project!.toLowerCase())?.color) : null,
        text,
        n.done || editingId === n.id ? null : el("span", { cls: "tasks-card-tools" }, arrow(left, "chevronLeft"), arrow(right, "chevronRight"),
          iconButton("edit", "Изменить текст (Enter)", () => { editingId = n.id; d.redraw(); }, "icon-btn sm"),
          iconButton("more", "Срок, проект и остальное", () => d.openEditor(n), "icon-btn sm"))),
      B.compact ? meta(due) : meta(due,
        n.priority === "high" && !n.done ? el("span", { cls: "tasks-card-flag", textContent: "⚑ важно" }) : null,
        col === "waiting" ? el("span", { cls: "tasks-card-waiting", textContent: (n.waitingFor ? "жду: " + n.waitingFor : "жду ответа") + (waitDays !== null ? " · " + (waitDays ? daysWord(waitDays) : "с сегодня") : "") }) : null,
        col === "doing" && statusDays(n) ? "в работе " + daysWord(statusDays(n)!) : null,
        n.followUpAt && !n.done ? "спросить " + d.when(n.followUpAt, false) : null,
        n.estimateMinutes && !n.meeting ? n.estimateMinutes + " мин" : null,
        goal ? "◎ " + goal : n.project && B.lanes !== "project" ? "#" + n.project : null,
        n.done && n.completedAt ? "сделано " + d.when(n.completedAt, false) : null),
      stepsBtn,
      stepsOpen && kids.length && !B.compact ? el("ul", { cls: "tasks-card-steps" }, ...kids.map((k) => {
        const kb = el("input", { type: "checkbox", checked: k.done, attrs: { "aria-label": (k.done ? "Вернуть шаг: " : "Шаг сделан: ") + k.text } });
        kb.addEventListener("change", () => { focusId = n.id; d.setDone(k.id, kb.checked); });
        return el("li", { cls: k.done ? "done" : "" }, kb, el("span", { textContent: k.text }));
      })) : null,
      askWait === n.id && col === "waiting" ? waitForm(n) : null].filter((x): x is HTMLElement => !!x));
    c.draggable = editingId !== n.id && askWait !== n.id;
    c.addEventListener("dragstart", (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData(DRAG_TYPE, n.id); e.dataTransfer.effectAllowed = "move";
      dragId = n.id;
      d.page().classList.add("tasks-dragging");
      ghost.style.height = c.offsetHeight + "px";
      requestAnimationFrame(() => c.classList.add("dragging"));
    });
    c.addEventListener("dragend", () => { dragId = null; c.classList.remove("dragging"); ghost.remove(); d.page().classList.remove("tasks-dragging"); });
    // Shift or Ctrl + click picks the card for the bar of actions over the board
    c.addEventListener("mousedown", (e) => { if (e.shiftKey && !n.done) e.preventDefault(); });
    c.addEventListener("click", (e) => {
      if (!(e.shiftKey || e.ctrlKey || e.metaKey) || n.done || (e.target as HTMLElement).closest("button,input,a")) return;
      e.preventDefault();
      pick(n.id, c);
    });
    return c;
  };
  const pick = (id: string, c: HTMLElement) => {
    if (d.selected.has(id)) d.selected.delete(id); else d.selected.add(id);
    c.classList.toggle("picked", d.selected.has(id));
    d.onSelect();
  };

  // ---------- a column ----------
  /** Where in the list of cards the pointer is: the card it goes before (null: at the end). */
  const beforeCard = (list: HTMLElement, y: number) =>
    [...list.querySelectorAll<HTMLElement>(".tasks-card:not(.dragging)")].find((x) => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; }) ?? null;
  const dropList = (list: HTMLElement, col: BoardCol, laneKey: string, full: Note[]) => {
    list.dataset.col = col;
    list.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move";
      if (col === "done") { list.closest(".tasks-col")?.classList.add("drop"); return; }
      const before = beforeCard(list, e.clientY);
      if (before) { if (ghost.nextElementSibling !== before) list.insertBefore(ghost, before); } else if (ghost.parentElement !== list || ghost.nextElementSibling) list.append(ghost);
    });
    list.addEventListener("dragleave", (e) => { if (!list.contains(e.relatedTarget as Node | null)) { ghost.remove(); list.closest(".tasks-col")?.classList.remove("drop"); } });
    list.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      list.closest(".tasks-col")?.classList.remove("drop");
      const n = find(e.dataTransfer?.getData(DRAG_TYPE) || dragId);
      const before = ghost.parentElement === list ? (ghost.nextElementSibling as HTMLElement | null)?.dataset.id : undefined;
      const last = [...list.querySelectorAll<HTMLElement>(".tasks-card:not(.dragging)")].at(-1)?.dataset.id;
      ghost.remove(); d.page().classList.remove("tasks-dragging");
      if (!n) return;
      if (col === "done") { moveCard(n, "done"); return; }
      const ids = full.map((x) => x.id);
      const at = before ? ids.indexOf(before) : last ? ids.indexOf(last) + 1 : ids.length;
      moveCard(n, col, { order: placeAt(ids, n.id, at < 0 ? ids.length : at), lane: laneKey });
    });
    return list;
  };
  const addRow = (col: BoardCol, laneKey: string) => {
    const key = laneKey + "|" + col;
    if (adding !== key) {
      const b = el("button", { type: "button", cls: "tasks-col-add" }, icon("plus", 15), el("span", { textContent: "Добавить" }));
      b.addEventListener("click", () => { adding = key; draft.add = ""; focusField = true; d.redraw(); });
      return b;
    }
    const input = el("input", { type: "text", maxLength: 500, cls: "mem-input", value: draft.add, placeholder: "Например: отчёт в пятницу !", enterKeyHint: "done", attrs: { "aria-label": "Новое дело в «" + STATUS_LABEL[col] + "»" } });
    input.addEventListener("input", () => { draft.add = input.value; });
    const save = async () => {
      const t = input.value.trim();
      if (!t) { input.focus(); return; }
      input.disabled = true;
      const p = parseQuick(t, new Date(), "todo");
      const lane = B.lanes === "project" && laneKey && !p.project ? { project: laneKey } : B.lanes === "area" && laneKey ? { area: laneKey as Area } : {};
      let newId = "";
      const ok = await d.act(async () => {
        const r = await d.saveQuick({ ...p, ...lane }, d.area() === "all" ? undefined : d.area() as Area);
        if (!r.ok || !r.value) return r;
        newId = r.value.id;
        return col === "todo" ? r : api.updateTask(newId, { status: col as "doing" | "waiting" });
      }, "Дело добавлено");
      if (ok) draft.add = "";
      if (ok && col === "waiting") { askWait = newId; adding = null; } else if (ok) { adding = key; }
      focusField = true;
      d.redraw();
    };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key === "Escape") { e.preventDefault(); adding = null; draft.add = ""; d.redraw(); } });
    if (focusField || keepField === "add") { focusField = false; queueMicrotask(() => input.focus()); }
    return el("div", { cls: "tasks-col-addform" }, input, el("div", { cls: "row" }, btn("Добавить", () => void save(), { small: true, primary: true }), btn("Закрыть", () => { adding = null; draft.add = ""; d.redraw(); }, { small: true })));
  };
  const column = (col: BoardCol, list: Note[], laneKey: string): HTMLElement => {
    const key = laneKey + "|" + col;
    const folded = col === "done" && B.doneFolded;
    const over = col === "doing" && list.length > WIP_LIMIT;
    const head = el("h2", {}, el("span", { cls: "tasks-col-title", textContent: STATUS_LABEL[col] }), el("span", { cls: "n", textContent: String(list.length) }),
      over ? el("span", { cls: "tasks-col-warn", title: `В работе больше ${WIP_LIMIT} дел: лучше закончить начатое, чем браться за новое`, textContent: "многовато" }) : null,
      el("span", { cls: "grow" }),
      col === "done" ? iconButton(folded ? "chevronLeft" : "chevronRight", folded ? "Развернуть «Готово»" : "Свернуть «Готово»", () => { B.doneFolded = !folded; savePref(); d.redraw(); }, "icon-btn sm tasks-col-fold") : null);
    const sec = el("section", { cls: "tasks-col " + col + (list.length ? "" : " is-empty") + (folded ? " folded" : "") + (over ? " over" : "") + (B.tab === col ? " on" : ""), attrs: { "aria-label": STATUS_LABEL[col] + ": " + list.length } }, head);
    if (folded) {
      const strip = el("button", { type: "button", cls: "tasks-col-strip", title: "Развернуть «Готово»" }, el("span", { textContent: `Готово · ${list.length}` }));
      strip.addEventListener("click", () => { B.doneFolded = false; savePref(); d.redraw(); });
      sec.append(dropList(el("div", { cls: "tasks-col-cards" }, strip), col, laneKey, list));
      return sec;
    }
    const cut = !showAll.has(key) && list.length > COL_LIMIT + 2;
    const shown = new Set((cut ? list.slice(0, COL_LIMIT) : list).map((n) => n.id));
    const cards = el("div", { cls: "tasks-col-cards" });
    if (!list.length) cards.append(el("p", { cls: "tasks-col-empty", textContent: HINT[col] }));
    else if (col === "todo") {
      for (const g of todoBuckets(list)) {
        const vis = g.notes.filter((n) => shown.has(n.id));
        if (!vis.length) continue;
        cards.append(el("h3", { cls: "tasks-col-sub " + g.key }, el("span", { textContent: BUCKET_LABEL[g.key] }), el("small", { textContent: String(g.notes.length) })), ...vis.map((n) => card(n, laneKey)));
      }
    } else cards.append(...list.filter((n) => shown.has(n.id)).map((n) => card(n, laneKey)));
    sec.append(dropList(cards, col, laneKey, list));
    if (cut) sec.append(el("button", { type: "button", cls: "tasks-more", textContent: `Показать ещё ${list.length - COL_LIMIT}`, onclick: () => { showAll.add(key); d.redraw(); } }));
    if (col !== "done") sec.append(addRow(col, laneKey));
    return sec;
  };

  // ---------- the bar over the board ----------
  const toolbar = (cols: Record<BoardCol, Note[]>) => {
    const lanes = el("select", { cls: "mem-select tasks-board-lanes", attrs: { "aria-label": "Строки доски" } },
      el("option", { value: "none", textContent: "Без строк" }), el("option", { value: "project", textContent: "Строки: проекты" }), el("option", { value: "area", textContent: "Строки: работа и личное" }));
    lanes.value = B.lanes;
    lanes.addEventListener("change", () => { B.lanes = lanes.value as LaneMode; savePref(); d.redraw(); });
    const compact = iconButton("rows", B.compact ? "Подробные карточки" : "Компактные карточки: только текст и срок", () => { B.compact = !B.compact; savePref(); d.redraw(); }, "icon-btn sm" + (B.compact ? " on" : ""));
    compact.setAttribute("aria-pressed", String(B.compact));
    const tabs = el("div", { cls: "tasks-board-tabs", attrs: { role: "tablist", "aria-label": "Колонки" } }, ...BOARD_COLS.map((c) => {
      const b = el("button", { type: "button", cls: "tasks-tab" + (B.tab === c ? " on" : ""), attrs: { role: "tab", "aria-selected": String(B.tab === c) } },
        el("span", { textContent: STATUS_LABEL[c] }), el("small", { textContent: String(cols[c].length) }));
      b.addEventListener("click", () => { B.tab = c; savePref(); d.redraw(); });
      return b;
    }));
    return el("div", { cls: "tasks-board-bar" },
      el("div", { cls: "chips", attrs: { role: "group", "aria-label": "Фильтры доски" } },
        chip("⚑ Важные", null, B.important, () => { B.important = !B.important; savePref(); d.redraw(); }),
        chip("До конца недели", null, B.week, () => { B.week = !B.week; savePref(); d.redraw(); })),
      el("span", { cls: "grow" }), lanes, compact, tabs);
  };

  // ---------- keys on a card ----------
  const onKey = (e: KeyboardEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".tasks-card");
    if (!c || (e.target as HTMLElement).closest("input,select,textarea,button") || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = find(c.dataset.id);
    if (!n) return;
    const col = columnOf(n);
    const step = (dir: 1 | -1) => {
      const list = [...(c.closest(".tasks-col")?.querySelectorAll<HTMLElement>(".tasks-card") ?? [])];
      list[list.indexOf(c) + dir]?.focus();
    };
    const key = e.key, code = e.code;
    if (key === "ArrowLeft" || key === "ArrowRight") { const to = sideColumn(col, key === "ArrowLeft" ? -1 : 1); if (n.done) { if (key === "ArrowLeft") moveCard(n, n.status ?? "todo"); } else if (to) moveCard(n, to); }
    else if (key === "ArrowDown" || code === "KeyJ") step(1);
    else if (key === "ArrowUp" || code === "KeyK") step(-1);
    else if (key === "Enter" && !n.done) { editingId = n.id; d.redraw(); }
    else if (key === " " || code === "Space") { focusId = n.id; d.setDone(n.id, !n.done, c); }
    else if (key === "Delete" || key === "Backspace") d.remove(n);
    else if (code === "KeyX" && !n.done) pick(n.id, c);
    else return;
    e.preventDefault();
  };

  return () => {
    // the keyboard stays on the same card across the redraw (after a move or the server's answer)
    focusId ??= (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(".tasks-card")?.dataset.id ?? null;
    const active = document.activeElement;
    keepField = active?.closest(".tasks-card-wait") ? "wait" : active?.closest(".tasks-col-addform") ? "add" : null;
    if (active?.closest(".tasks-card input,.tasks-col-addform")) focusId = null;
    const notes = boardFilter(d.notes().filter((n) => n.kind === "todo" && !n.auto && !n.parentId), { important: B.important, week: B.week });
    const all = boardColumns(notes);
    const lanes = boardLanes(notes, B.lanes, d.projects(), (id) => d.goalTitle(id)).filter((l) => B.lanes === "none" || l.notes.length);
    const grids = lanes.map((lane) => {
      const cols = lane.key === "" && B.lanes === "none" ? all : boardColumns(lane.notes);
      const grid = el("div", { cls: "tasks-board" + (B.doneFolded ? " done-folded" : ""), attrs: { role: "group", "aria-label": lane.label || "Доска дел по статусам" } }, ...BOARD_COLS.map((c) => column(c, cols[c], lane.key)));
      if (B.lanes === "none") return grid;
      const open = BOARD_COLS.filter((c) => c !== "done").reduce((s, c) => s + cols[c].length, 0);
      return el("section", { cls: "tasks-lane" }, el("h3", { cls: "tasks-lane-head" }, lane.color ? d.dot(lane.color) : null, el("span", { textContent: lane.label }), el("small", { cls: "muted", textContent: open ? "открыто " + open : "всё сделано" })), grid);
    });
    const empty = !notes.length && (B.important || B.week)
      ? el("div", { cls: "tasks-board-none" }, el("span", { cls: "muted small", textContent: "С этими фильтрами дел нет." }), btn("Показать все", () => { B.important = B.week = false; savePref(); d.redraw(); }, { small: true }))
      : null;
    const host = el("div", { cls: "tasks-boardview" + (B.compact ? " compact" : "") + (B.lanes !== "none" ? " laned" : "") }, toolbar(all), empty, ...grids);
    host.addEventListener("keydown", onKey);
    if (focusId) {
      const id = focusId; focusId = null;
      queueMicrotask(() => { if (!document.activeElement?.closest("input,textarea,select")) host.querySelector<HTMLElement>(`.tasks-card[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); });
    }
    return host;
  };
}
