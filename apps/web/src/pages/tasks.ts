/**
 * "Дела" — the start page: quick entry in one line, one timeline of to-dos and reminders by day,
 * notes; beside it (below on a phone) a calendar with the production calendar, the day plan and goals.
 */
import { api, type Note, type Reminder, type Repeat } from "../api";
import { el, icon, iconButton } from "../dom";
import { app, refreshBrief, type AppState, type Route } from "../state";
import { showToast } from "../toast";
import { buildAttention } from "./home";
import { btn, chip, emptyState } from "./kit";
import { prodDay, prodStats, type DayKind } from "./prod-calendar";
import { endOfDay, parseQuick, type QuickKind, type QuickParsed } from "./quick-entry";
import { REPEAT_LABEL, REPEAT_OPTIONS, buildTasks, isDateOnly, localDay, toLocalInput, type TaskFilter, type TimedItem } from "./tasks-model";

type Mission = { id: string; title: string; description: string; status: "active" | "paused" | "complete"; total: number; done: number; percent: number; blocked: number; next: { id: string; text: string; reason: string } | null; stages: { id: string; text: string; done: boolean }[] };
const KINDS: [QuickKind, string][] = [["auto", "Авто"], ["todo", "Дело"], ["reminder", "Напоминание"], ["note", "Заметка"]];
/** Kept across re-renders and visits: filter, search, the kind of the new entry, the calendar month and day. */
const UI = { filter: "all" as TaskFilter, query: "", kind: "auto" as QuickKind, month: "", day: "" };
/** Deletions waiting for their "Отменить" window to pass; hidden from the list meanwhile. */
const pendingDelete = new Set<string>();
const UNDO_MS = 6000;

const fromLocal = (v: string): string | null => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
const hm = (iso: string | number) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayMonth = (iso: string | number) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
function repeatSelect(value: Repeat | undefined, label: string): HTMLSelectElement {
  const s = el("select", { cls: "mem-select", attrs: { "aria-label": label } }, ...REPEAT_OPTIONS.map(([v, t]) => el("option", { value: v, textContent: t })));
  s.value = value ?? "none";
  return s;
}
/** "сегодня 18:00", "завтра", "пн 12 окт. 09:00": when, in words, relative to now. */
export function whenLabel(iso: string, dateOnly: boolean, now = new Date()): string {
  const key = localDay(iso), today = localDay(now);
  const tomorrow = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const day = key === today ? "сегодня" : key === tomorrow ? "завтра" : key === yesterday ? "вчера"
    : new Date(iso).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  return dateOnly ? day : `${day} ${hm(iso)}`;
}
/** Words for the preview under the quick-entry field. */
export function describeQuick(p: QuickParsed, now = new Date()): string {
  const kind = p.kind === "reminder" ? "Напоминание" : p.kind === "note" ? "Заметка" : "Дело";
  return [kind, p.at ? (p.kind === "todo" ? "срок " : "") + whenLabel(p.at, !!p.dateOnly && p.kind === "todo", now) : p.kind === "reminder" ? "время не указано" : null,
    p.repeat ? "↻ " + REPEAT_LABEL[p.repeat] : null, p.kind === "todo" && p.priority ? "⚑ важно" : null, p.kind === "todo" && p.project ? "#" + p.project : null].filter(Boolean).join(" · ");
}

const DAY_KIND: Record<DayKind, string> = { work: "Рабочий день", short: "Сокращённый день", weekend: "Выходной", holiday: "Праздник", off: "Перенесённый выходной" };
const fmtH = (h: number) => h.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " ч";

/** The quick-entry result with the date and repeat picked by hand. */
export function withWhen(p: QuickParsed, iso: string | null, rep: string): QuickParsed {
  const { at: _a, repeat: _r, ...rest } = p;
  const out: QuickParsed = { ...rest };
  if (iso) out.at = iso;
  if (rep !== "none") out.repeat = rep as Repeat;
  return out;
}

/** Saves a parsed quick entry: a reminder, a note, or a to-do with its due date, importance and project. */
export async function saveQuick(p: QuickParsed): Promise<{ ok: boolean; error?: { message: string } }> {
  if (p.kind === "reminder") return api.addReminder(p.text, p.at!, p.repeat);
  if (p.kind === "note") return api.addNote("note", p.text);
  const r = await api.addNote("todo", p.text);
  if (!r.ok || (!p.at && !p.priority && !p.project)) return r;
  return api.updateTask(r.value.id, { ...(p.at ? { dueAt: p.dateOnly ? endOfDay(p.at) : p.at } : {}), ...(p.priority ? { priority: p.priority } : {}), ...(p.project ? { project: p.project } : {}) });
}
/** The toast after `saveQuick`. */
export function savedText(p: QuickParsed): string {
  if (p.kind === "reminder") return "Напоминание: " + whenLabel(p.at!, false) + (p.repeat ? ", " + REPEAT_LABEL[p.repeat] : "");
  if (p.kind === "note") return "Заметка добавлена";
  return p.at ? "Дело добавлено: срок " + whenLabel(p.at, !!p.dateOnly) : "Дело добавлено";
}
/** Opens the page already filtered by `q` (a search result from Ctrl+K). */
export function searchTasksFor(q: string) { UI.query = q; UI.filter = "all"; }

export interface TasksDeps { go(r: Route): void; openChat(): void }

export function tasksPage(deps: TasksDeps): HTMLElement {
  let data: { notes: Note[]; reminders: Reminder[] } | null = null;
  let missions: Mission[] = [];
  let loadError = "";
  /** The entry being edited, so a reload (after another change) keeps the editor open. */
  let editing: string | null = null;
  const listHost = el("div", { cls: "tasks-list", attrs: { "aria-live": "polite" } });
  const chipsHost = el("div", { cls: "chips", attrs: { role: "group", "aria-label": "Что показать" } });
  const summary = el("p", { cls: "muted tasks-summary" });
  const attHost = el("div", { cls: "tasks-attn" });
  const calHost = el("section", { cls: "pg-card tasks-side-card tasks-cal", attrs: { "aria-label": "Календарь" } });
  const dayHost = el("section", { cls: "pg-card tasks-side-card", attrs: { "aria-label": "План дня" } });
  const goalsHost = el("section", { cls: "pg-card tasks-side-card", attrs: { "aria-label": "Цели" } });

  const load = async () => {
    const [r, m] = await Promise.all([api.organizer(), api.missions()]);
    if (r.ok) { data = r.value; loadError = ""; } else loadError = r.error.message;
    if (m.ok) missions = m.value;
    render();
    void renderSide();
  };
  /** Runs a change, reports a failure, reloads the list and the reminder badge. */
  const act = async (run: () => Promise<{ ok: boolean; error?: { message: string } }>, ok?: string, undo?: () => void) => {
    const r = await run();
    if (!r.ok) showToast(r.error?.message ?? "Не получилось", { ms: 8000 });
    else if (ok) showToast(ok, undo ? { ms: UNDO_MS, action: { label: "Отменить", run: undo } } : { ms: 2500 });
    await load();
    void refreshBrief();
    return r.ok;
  };
  /** Hides the entry at once and deletes it only when "Отменить" was not pressed in time. */
  const removeLater = (id: string, label: string, run: () => ReturnType<typeof api.removeNote>) => {
    pendingDelete.add(id);
    editing = editing === id ? null : editing;
    render();
    let undone = false;
    showToast(label, { ms: UNDO_MS, action: { label: "Отменить", run: () => { undone = true; pendingDelete.delete(id); render(); } } });
    setTimeout(async () => {
      if (undone) return;
      const r = await run();
      pendingDelete.delete(id);
      if (!r.ok) showToast(r.error.message, { ms: 8000 });
      if (root.isConnected) await load();
      void refreshBrief();
    }, UNDO_MS);
  };
  const missionTitle = (id?: string) => (id ? missions.find((m) => m.id === id)?.title : undefined);

  // ---------- quick entry ----------
  const text = el("input", { type: "text", maxLength: 500, cls: "mem-input tasks-quick-input", placeholder: "Например: завтра в 10 позвонить маме", enterKeyHint: "done", attrs: { "aria-label": "Новое дело, напоминание или заметка", "aria-describedby": "tasks-preview" } });
  const preview = el("p", { cls: "tasks-preview muted small", id: "tasks-preview", attrs: { "aria-live": "polite" } });
  const at = el("input", { type: "datetime-local", cls: "mem-select", attrs: { "aria-label": "Когда напомнить" } });
  const repeat = repeatSelect(undefined, "Повтор");
  const when_ = el("div", { cls: "tasks-when" }, at, repeat);
  /** The date field was changed by hand: typing no longer overwrites it. */
  let manualWhen = false;
  at.addEventListener("input", () => { manualWhen = true; });
  repeat.addEventListener("change", () => { manualWhen = true; });
  const add = btn("Добавить", () => {}, { primary: true, icon: "plus" });
  add.type = "submit";
  const kinds = el("div", { cls: "segmented tasks-kinds", attrs: { role: "radiogroup", "aria-label": "Что добавить" } });
  const parsed = () => parseQuick(text.value, new Date(), UI.kind);
  const syncQuick = () => {
    const p = parsed();
    // the date fields appear when a reminder is wanted but the text has no time: fill them in by hand
    const needWhen = p.kind === "reminder" && (UI.kind === "reminder" || !p.at);
    when_.hidden = !needWhen;
    if (needWhen && !manualWhen) {
      at.value = toLocalInput(p.at ?? new Date(Date.now() + 3_600_000).toISOString()).slice(0, 14) + (p.at ? toLocalInput(p.at).slice(14) : "00");
      repeat.value = p.repeat ?? "none";
    }
    preview.textContent = text.value.trim() ? describeQuick(needWhen && at.value ? withWhen(p, fromLocal(at.value), repeat.value) : p) : "Можно писать сразу с датой и временем: «по будням в 10 стендап», «отчёт в пятницу !», «заметка: код 1234».";
  };
  const syncKind = () => {
    kinds.replaceChildren(...KINDS.map(([k, label]) => {
      const b = el("button", { type: "button", textContent: label, attrs: { role: "radio", "aria-checked": String(UI.kind === k) } });
      b.addEventListener("click", () => { UI.kind = k; manualWhen = false; syncKind(); syncQuick(); text.focus(); });
      return b;
    }));
  };
  text.addEventListener("input", () => syncQuick());
  syncKind(); syncQuick();
  const form = el("form", { cls: "tasks-add" }, el("div", { cls: "tasks-add-row" }, text, add), preview, el("div", { cls: "tasks-add-row tasks-add-opts" }, kinds, when_));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!text.value.trim()) { text.focus(); return; }
    let p = parsed();
    if (!when_.hidden) {
      const iso = fromLocal(at.value);
      if (!iso) { showToast("Укажите дату и время."); at.focus(); return; }
      p = withWhen(p, iso, repeat.value);
    }
    add.disabled = true;
    const ok = await act(() => saveQuick(p), savedText(p));
    add.disabled = false;
    if (ok) { text.value = ""; manualWhen = false; syncQuick(); text.focus(); }
  });

  // ---------- rows ----------
  const meta = (...parts: (string | null | false | undefined | HTMLElement)[]) => {
    const kids = parts.filter((x): x is string | HTMLElement => !!x);
    return kids.length ? el("span", { cls: "tasks-meta" }, ...kids.map((k) => typeof k === "string" ? el("span", { textContent: k }) : k)) : null;
  };
  const body = (title: string, m: HTMLElement | null) => el("span", { cls: "grow tasks-body" }, el("span", { cls: "tasks-text", textContent: title }), m);
  const todoEditor = (n: Note): HTMLElement => {
    const input = el("input", { type: "text", maxLength: 500, value: n.text, cls: "mem-input", attrs: { "aria-label": "Текст дела" } });
    const due = el("input", { type: "datetime-local", cls: "mem-select", value: n.dueAt ? toLocalInput(n.dueAt) : "", attrs: { "aria-label": "Срок" } });
    const priority = el("select", { cls: "mem-select", attrs: { "aria-label": "Важность" } }, el("option", { value: "normal", textContent: "Обычное" }), el("option", { value: "high", textContent: "⚑ Важное" }), el("option", { value: "low", textContent: "Неважное" }));
    priority.value = n.priority ?? "normal";
    const mission = missionTitle(n.project);
    const project = el("input", { type: "text", maxLength: 80, value: mission ? "" : n.project ?? "", cls: "mem-input", placeholder: mission ? "Цель: " + mission : "Проект, например работа", disabled: !!mission, attrs: { "aria-label": "Проект" } });
    const estimate = el("input", { type: "number", min: "1", max: "1440", step: "5", value: n.estimateMinutes ? String(n.estimateMinutes) : "", cls: "mem-select tasks-est", placeholder: "мин", attrs: { "aria-label": "Сколько минут займёт" } });
    const parents = data?.notes.filter((x) => x.kind === "todo" && !x.done && x.id !== n.id && !x.parentId) ?? [];
    const hasKids = !!data?.notes.some((x) => x.parentId === n.id);
    const parent = el("select", { cls: "mem-select", disabled: hasKids, attrs: { "aria-label": "Входит в дело" } }, el("option", { value: "", textContent: hasKids ? "Есть свои подзадачи" : "Самостоятельное дело" }), ...parents.map((x) => el("option", { value: x.id, textContent: "Шаг дела: " + x.text.slice(0, 60) })));
    parent.value = n.parentId ?? "";
    const save = btn("Сохранить", async () => {
      const t = input.value.trim();
      if (!t) { input.focus(); return; }
      save.disabled = true;
      const minutes = estimate.value ? Math.min(1440, Math.max(1, Math.round(Number(estimate.value)))) : null;
      const ok = await act(async () => {
        if (t !== n.text) { const r = await api.editNote(n.id, t); if (!r.ok) return r; }
        return api.updateTask(n.id, { dueAt: due.value ? fromLocal(due.value) : null, priority: priority.value as NonNullable<Note["priority"]>, estimateMinutes: Number.isFinite(minutes) ? minutes : null,
          ...(mission ? {} : { project: project.value.trim() || null }), ...(hasKids ? {} : { parentId: parent.value || null }) });
      }, "Сохранено");
      if (ok) editing = null;
      render();
    }, { small: true, primary: true });
    const cancel = btn("Отмена", () => { editing = null; render(); }, { small: true });
    for (const f of [input, due, project, estimate]) f.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save.click(); } else if (e.key === "Escape") { e.preventDefault(); cancel.click(); } });
    queueMicrotask(() => { input.focus(); input.select(); });
    return el("li", { cls: "org-row editing" }, el("div", { cls: "tasks-editor" }, input,
      el("div", { cls: "tasks-editor-grid" },
        el("label", {}, el("span", { textContent: "Срок" }), due), el("label", {}, el("span", { textContent: "Важность" }), priority),
        el("label", {}, el("span", { textContent: "Проект" }), project), el("label", {}, el("span", { textContent: "Минут" }), estimate),
        el("label", { cls: "wide" }, el("span", { textContent: "Входит в" }), parent)),
      el("div", { cls: "row" }, save, cancel)));
  };
  const simpleEditor = (initial: string, extra: HTMLElement[], save: (t: string) => Promise<boolean>) => {
    const input = el("input", { type: "text", maxLength: 500, value: initial, cls: "mem-input", attrs: { "aria-label": "Текст" } });
    const ok = btn("Сохранить", async () => { const v = input.value.trim(); if (!v) { input.focus(); return; } ok.disabled = true; if (await save(v)) editing = null; render(); }, { small: true, primary: true });
    const cancel = btn("Отмена", () => { editing = null; render(); }, { small: true });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } else if (e.key === "Escape") { e.preventDefault(); cancel.click(); } });
    queueMicrotask(() => { input.focus(); input.select(); });
    return el("li", { cls: "org-row editing" }, el("div", { cls: "tasks-edit" }, input, ...extra, el("div", { cls: "row" }, ok, cancel)));
  };

  const todoRow = (n: Note, kids: Note[] = []): HTMLElement => {
    if (editing === n.id) return todoEditor(n);
    const box = el("input", { type: "checkbox", checked: n.done, attrs: { "aria-label": (n.done ? "Вернуть в работу: " : "Выполнено: ") + n.text } });
    box.addEventListener("change", () => void act(() => api.setTodoDone(n.id, box.checked), box.checked ? "Готово: " + n.text : "Дело снова в работе",
      box.checked ? () => void act(() => api.setTodoDone(n.id, false)) : undefined));
    const overdue = !n.done && n.dueAt && Date.parse(n.dueAt) < Date.now();
    const mission = missionTitle(n.project);
    const doneKids = kids.filter((k) => k.done).length;
    const star = iconButton("star", n.priority === "high" ? "Снять важность" : "Отметить важным", () => void act(() => api.updateTask(n.id, { priority: n.priority === "high" ? "normal" : "high" })), "icon-btn sm tasks-star" + (n.priority === "high" ? " on" : ""));
    star.setAttribute("aria-pressed", String(n.priority === "high"));
    const row = el("li", { cls: "org-row" + (n.done ? " done" : "") + (overdue ? " overdue" : "") + (n.priority === "high" && !n.done ? " important" : "") }, box,
      body(n.text, meta(
        n.dueAt ? el("span", { cls: overdue ? "late" : "", textContent: (overdue ? "просрочено · " : "") + whenLabel(n.dueAt, isDateOnly(n.dueAt)) }) : null,
        kids.length ? `шаги ${doneKids}/${kids.length}` : null,
        n.estimateMinutes ? n.estimateMinutes + " мин" : null,
        mission ? "◎ " + mission : n.project ? "#" + n.project : null,
        n.done && n.completedAt ? "сделано " + whenLabel(n.completedAt, false) : null)),
      n.done ? null : star,
      n.done ? null : iconButton("edit", "Изменить: " + n.text, () => { editing = n.id; render(); }, "icon-btn sm"),
      iconButton("trash", "Удалить: " + n.text, () => removeLater(n.id, kids.length ? `Дело удалено, его шаги (${kids.length}) стали отдельными делами` : "Дело удалено", () => api.removeNote(n.id)), "icon-btn sm"));
    if (!kids.length) return row;
    return el("li", { cls: "tasks-parent" }, el("ul", { cls: "org-list" }, row), el("ul", { cls: "org-list tasks-children" }, ...kids.filter((k) => !pendingDelete.has(k.id)).map((k) => todoRow(k))));
  };
  const reminderRow = (r: Reminder): HTMLElement => {
    if (editing === r.id && r.status === "scheduled") {
      const time = el("input", { type: "datetime-local", cls: "mem-select", value: toLocalInput(r.at), attrs: { "aria-label": "Когда напомнить" } });
      const rep = repeatSelect(r.repeat, "Повтор");
      return simpleEditor(r.text, [time, rep], (t) => {
        const iso = fromLocal(time.value);
        if (!iso) { showToast("Укажите дату и время."); return Promise.resolve(false); }
        return act(() => api.editReminder(r.id, { text: t, at: iso, repeat: rep.value as Repeat | "none" }), "Сохранено");
      });
    }
    const snooze = el("select", { cls: "mem-select tasks-snooze", attrs: { "aria-label": "Отложить напоминание" } },
      el("option", { value: "", textContent: "Отложить…" }), el("option", { value: "10", textContent: "на 10 минут" }), el("option", { value: "30", textContent: "на 30 минут" }),
      el("option", { value: "60", textContent: "на час" }), el("option", { value: "1440", textContent: "на сутки" }));
    snooze.addEventListener("change", () => { const m = Number(snooze.value); if (m) void act(() => api.snoozeReminder(r.id, m), "Напомню " + whenLabel(new Date(Date.now() + m * 60_000).toISOString(), false)); });
    return el("li", { cls: "org-row" + (r.status === "due" ? " due" : r.status === "done" ? " done" : "") },
      el("span", { cls: "org-ic", attrs: { "aria-hidden": "true" } }, icon("clock", 16)),
      body(r.text, meta(r.status === "due" ? "сработало " + whenLabel(r.firedAt ?? r.at, false) : whenLabel(r.at, false), r.repeat ? "↻ " + REPEAT_LABEL[r.repeat] : null)),
      r.status === "due" ? snooze : null,
      r.status === "due" ? btn("Готово", () => void act(() => api.dismissReminder(r.id)), { small: true, primary: true }) : null,
      r.status === "scheduled" ? iconButton("edit", "Изменить напоминание: " + r.text, () => { editing = r.id; render(); }, "icon-btn sm") : null,
      iconButton("trash", r.repeat ? "Удалить повторяющееся напоминание" : "Удалить напоминание", () =>
        removeLater(r.id, r.repeat ? "Повторяющееся напоминание удалено" : "Напоминание удалено", () => api.removeReminder(r.id)), "icon-btn sm"));
  };
  const noteRow = (n: Note): HTMLElement => {
    if (editing === n.id) return simpleEditor(n.text, [], (t) => act(() => api.editNote(n.id, t), "Сохранено"));
    return el("li", { cls: "org-row" },
      el("span", { cls: "org-ic", attrs: { "aria-hidden": "true" } }, icon("edit", 16)),
      body(n.text, meta(dayMonth(n.createdAt))),
      iconButton("check", "Сделать делом: " + n.text, () => void act(async () => {
        const r = await api.addNote("todo", n.text);
        if (!r.ok) return r;
        return api.removeNote(n.id);
      }, "Заметка стала делом"), "icon-btn sm"),
      iconButton("edit", "Изменить: " + n.text, () => { editing = n.id; render(); }, "icon-btn sm"),
      iconButton("trash", "Удалить: " + n.text, () => removeLater(n.id, "Заметка удалена", () => api.removeNote(n.id)), "icon-btn sm"));
  };
  const timedRow = (it: TimedItem, kids: Record<string, Note[]>) => it.type === "todo" ? todoRow(it.note, kids[it.note.id] ?? []) : reminderRow(it.reminder);
  const group = (title: string, rows: HTMLElement[], cls = "", hint?: string) => rows.length
    ? el("section", { cls: "tasks-group " + cls }, el("h2", {}, title, el("span", { cls: "n", textContent: String(rows.length) }), hint ? el("small", { cls: "muted", textContent: hint }) : null), el("ul", { cls: "org-list" }, ...rows)) : null;

  function render() {
    if (!data) { listHost.replaceChildren(loadError ? emptyState("alert", "Не удалось загрузить", loadError, btn("Повторить", () => void load(), { small: true })) : el("p", { cls: "muted", textContent: "Загрузка…" })); return; }
    const visible = { notes: data.notes.filter((n) => !pendingDelete.has(n.id)), reminders: data.reminders.filter((r) => !pendingDelete.has(r.id)) };
    const t = buildTasks(visible, UI.filter, UI.query);
    const c = t.counts;
    const opts: [TaskFilter, string, number][] = [["all", "Все", c.all], ["todo", "Дела", c.todo], ["reminder", "Напоминания", c.reminder], ["note", "Заметки", c.note]];
    chipsHost.replaceChildren(...opts.map(([f, label, n]) => chip(label, n, UI.filter === f, () => { UI.filter = f; render(); })));
    const today = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    const pdToday = prodDay(localDay(new Date()));
    summary.textContent = [today[0]!.toUpperCase() + today.slice(1), pdToday?.kind === "holiday" ? pdToday.note : pdToday?.kind === "off" ? "выходной (перенос)" : pdToday?.kind === "short" ? "сокращённый день" : null, t.summary.today ? `на сегодня: ${t.summary.today}` : "на сегодня ничего", t.summary.overdue ? `просрочено: ${t.summary.overdue}` : null, t.summary.doneToday ? `сделано: ${t.summary.doneToday}` : null].filter(Boolean).join(" · ");
    const kids = t.children;
    const finished = [...t.finished.todos.map((n) => todoRow(n)), ...t.finished.reminders.map(reminderRow)];
    const groups = [
      group("Сработали", t.due.map(reminderRow), "due"),
      group("Просрочено", t.overdue.map((x) => timedRow(x, kids)), "late"),
      group("Сегодня", t.today.map((x) => timedRow(x, kids)), "today"),
      group("Завтра", t.tomorrow.map((x) => timedRow(x, kids))),
      group("Позже", t.later.map((x) => timedRow(x, kids))),
      group("Без срока", t.someday.map((n) => todoRow(n, kids[n.id] ?? []))),
      group("Заметки", t.notes.map(noteRow)),
    ].filter((g): g is HTMLElement => !!g);
    const done = finished.length ? el("details", { cls: "br-fold tasks-done" }, el("summary", { textContent: `Выполненные · ${finished.length}` }), el("ul", { cls: "org-list" }, ...finished)) : null;
    if (!groups.length && !done) {
      listHost.replaceChildren(UI.query || UI.filter !== "all"
        ? emptyState("search", "Ничего не найдено", "Измените запрос или фильтр.")
        : emptyState("check", "Пока пусто", "Напишите выше, например «завтра в 10 позвонить маме» или «по будням в 9 стендап». В чате тоже можно: «Напоминай каждый будний день в 10 про стендап»."));
      return;
    }
    listHost.replaceChildren(...groups, ...(done ? [done] : []));
  }

  // ---------- attention (what was on the old Home page) ----------
  const renderAttention = (s: AppState) => {
    const items = buildAttention(s, { go: deps.go, openChat: deps.openChat, saveQuickCommand: (name, text) => {
      const cur = app.get().assistantSettings?.quickCommands ?? [];
      void api.saveAssistantSettings({ quickCommands: [...cur, { name, text }] }).then((r) => { if (r.ok) { app.set({ assistantSettings: r.value }); showToast(`Команда /${name} сохранена`); } else showToast(r.error.message); });
    }, dismissSuggestion: (name) => app.set((st) => ({ repeatSuggestions: st.repeatSuggestions.filter((x) => x.name !== name) })) })
      .filter((a) => a.id !== "reminder"); // fired reminders are already the first group of the list
    attHost.replaceChildren(...(items.length ? [el("ul", { cls: "attn" }, ...items.map((a) => {
      const b = btn(a.action, a.run, { small: true });
      const second = a.secondary ? btn(a.secondary.label, a.secondary.run, { small: true }) : null;
      return el("li", { cls: `attn-row ${a.tone}` }, icon(a.icon, 18), el("span", { cls: "grow", textContent: a.text }), ...(second ? [second] : []), b);
    }))] : []));
  };
  let attSig = "";
  const stopAtt = app.subscribe(() => {
    if (!root.isConnected) { stopAtt(); return; }
    const s = app.get();
    const sig = JSON.stringify([s.status?.assistant, !!s.status, s.approvals.length, s.chatOpen, s.update?.phase, s.update?.latest?.sha, s.update?.localVersion, s.update?.blocked, s.update?.rollbackPending, s.memory.filter((m) => m.status === "pending").length, s.modules.map((m) => m.status), s.repeatSuggestions[0]?.name]);
    if (sig !== attSig) { attSig = sig; renderAttention(s); }
  });

  // ---------- side panel: calendar, day plan, goals ----------
  let goalsSig = "";
  async function renderSide() {
    if (!UI.month) UI.month = localDay(new Date()).slice(0, 7);
    if (!UI.day) UI.day = localDay(new Date());
    await Promise.all([renderCalendar(), renderDay()]);
    // goals keep what is typed in their fields: redraw them only when they changed
    const sig = JSON.stringify(missions);
    if (sig !== goalsSig) { goalsSig = sig; renderGoals(); }
  }
  const cardHead = (title: string, ...extra: (Node | null)[]) => el("div", { cls: "tasks-side-head" }, el("h2", { textContent: title }), ...extra);
  const shiftMonth = (n: number) => { const [y, m] = UI.month.split("-").map(Number); const d = new Date(y!, m! - 1 + n, 1); UI.month = localDay(d).slice(0, 7); void renderCalendar(); };
  async function renderCalendar() {
    const r = await api.taskInsights(UI.month);
    const [y, mo] = UI.month.split("-").map(Number);
    const first = new Date(y!, mo! - 1, 1);
    const title = first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    const todayKey = localDay(new Date());
    const nav = el("div", { cls: "tasks-cal-nav" },
      iconButton("chevronLeft", "Предыдущий месяц", () => shiftMonth(-1), "icon-btn sm"),
      btn("Сегодня", () => { UI.month = todayKey.slice(0, 7); UI.day = todayKey; void renderSide(); }, { small: true }),
      iconButton("chevronRight", "Следующий месяц", () => shiftMonth(1), "icon-btn sm"));
    const head = cardHead(title[0]!.toUpperCase() + title.slice(1), nav);
    if (!r.ok) { calHost.replaceChildren(head, el("p", { cls: "muted small", textContent: "Календарь недоступен: " + r.error.message })); return; }
    const items = r.value.items;
    const byDay = new Map<string, typeof items>();
    for (const it of items) { const k = localDay(it.at); byDay.set(k, [...(byDay.get(k) ?? []), it]); }
    const cells: HTMLElement[] = [];
    for (let i = 0; i < (first.getDay() + 6) % 7; i++) cells.push(el("span", { cls: "tasks-calendar-empty" }));
    for (let d = 1; d <= new Date(y!, mo!, 0).getDate(); d++) {
      const key = `${UI.month}-${String(d).padStart(2, "0")}`;
      const list = byDay.get(key) ?? [];
      const pd = prodDay(key);
      const label = `${d}${pd && pd.kind !== "work" ? ", " + DAY_KIND[pd.kind].toLowerCase() + (pd.note ? " (" + pd.note + ")" : "") : ""}` + (list.length ? `: записей ${list.length}` : "");
      const cell = el("button", { type: "button", cls: "tasks-calendar-day" + (pd && pd.kind !== "work" ? " " + pd.kind : "") + (key === todayKey ? " today" : "") + (key === UI.day ? " selected" : ""), title: label, attrs: { "aria-pressed": String(key === UI.day), "aria-label": label } },
        el("span", { cls: "tasks-calendar-num", textContent: String(d) }),
        list.length ? el("span", { cls: "tasks-calendar-dots", attrs: { "aria-hidden": "true" } }, ...list.slice(0, 3).map((x) => el("i", { cls: (x.done ? "done" : "") + (x.kind === "reminder" ? " rem" : "") }))) : null);
      cell.addEventListener("click", () => { UI.day = key; void renderSide(); });
      cells.push(cell);
    }
    const ms = prodStats(UI.month), ys = prodStats(UI.month.slice(0, 4));
    calHost.replaceChildren(head,
      el("div", { cls: "tasks-calendar-weekdays" }, ...["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((x) => el("span", { textContent: x }))),
      el("div", { cls: "tasks-calendar-grid" }, ...cells),
      el("div", { cls: "tasks-calendar-legend muted small", attrs: { "aria-hidden": "true" } }, ...(["holiday", "off", "short"] as const).map((k) => el("span", { cls: "lg " + k, textContent: k === "off" ? "Перенос" : k === "short" ? "−1 час" : "Праздник" })), el("span", { cls: "lg dot", textContent: "Есть дела" })),
      ms && ys
        ? el("p", { cls: "tasks-prod muted small", title: `За ${UI.month.slice(0, 4)} год: ${ys.workDays} рабочих дней, ${ys.offDays} выходных и праздников, норма ${fmtH(ys.hours[40])} при 40 ч, ${fmtH(ys.hours[36])} при 36 ч, ${fmtH(ys.hours[24])} при 24 ч в неделю.` },
            el("span", { textContent: `Рабочих дней: ${ms.workDays} из ${ms.workDays + ms.offDays} · норма ${fmtH(ms.hours[40])}` + (ms.shortDays ? ` · сокращённых: ${ms.shortDays}` : "") }),
            el("span", { textContent: `За год: ${ys.workDays} рабочих дней, норма ${fmtH(ys.hours[40])} (40 ч), ${fmtH(ys.hours[36])} (36 ч), ${fmtH(ys.hours[24])} (24 ч)` }))
        : el("p", { cls: "tasks-prod muted small", textContent: "Производственный календарь есть на 2026 и 2027 годы." }));
  }
  async function renderDay() {
    const [plan, blocks, ins] = await Promise.all([UI.day === localDay(new Date()) ? api.taskPlan() : Promise.resolve(null), api.timeBlocks(UI.day), api.taskInsights(UI.day.slice(0, 7))]);
    const dayName = new Date(UI.day + "T12:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    const sel = prodDay(UI.day);
    const dayItems = ins.ok ? ins.value.items.filter((x) => localDay(x.at) === UI.day).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : [];
    const open = data?.notes.filter((n) => n.kind === "todo" && !n.done && (!n.dueAt || localDay(n.dueAt) !== UI.day)) ?? [];
    const pick = el("select", { cls: "mem-select", attrs: { "aria-label": "Перенести дело на этот день" } }, el("option", { value: "", textContent: "＋ Перенести сюда дело…" }), ...open.map((n) => el("option", { value: n.id, textContent: n.text.slice(0, 80) })));
    pick.addEventListener("change", () => {
      const n = open.find((x) => x.id === pick.value);
      if (!n) return;
      // keep the task's own time of day; a to-do without one is due at the end of the chosen day
      const time = n.dueAt && !isDateOnly(n.dueAt) ? toLocalInput(n.dueAt).slice(11) : "23:59";
      const iso = fromLocal(`${UI.day}T${time}`);
      if (iso) void act(() => api.updateTask(n.id, { dueAt: iso }), "Перенесено на " + whenLabel(iso, time === "23:59"));
    });
    const parts: (Node | null)[] = [cardHead(dayName[0]!.toUpperCase() + dayName.slice(1)),
      sel ? el("p", { cls: "tasks-prod-day " + sel.kind, textContent: DAY_KIND[sel.kind] + (sel.note ? ". " + sel.note : "") }) : null];
    parts.push(dayItems.length
      ? el("ul", { cls: "tasks-plan-list" }, ...dayItems.map((x) => el("li", { cls: x.done ? "done" : "" }, el("span", { cls: "tasks-plan-time", textContent: isDateOnly(x.at) ? "весь день" : hm(x.at) }), el("span", { cls: "grow", textContent: (x.kind === "reminder" ? "◷ " : "") + x.text }))))
      : el("p", { cls: "muted small", textContent: "В этот день ничего не запланировано." }));
    if (open.length) parts.push(pick);
    if (plan?.ok && plan.value.suggested.length) {
      parts.push(el("h3", { textContent: "Что сделать сначала" }),
        el("ol", { cls: "tasks-plan-list numbered" }, ...plan.value.suggested.slice(0, 5).map((x) => el("li", {}, el("span", { cls: "grow", textContent: x.text }), el("span", { cls: "br-tag", textContent: x.reason })))));
    }
    if (blocks.ok && blocks.value.blocks.length) {
      const v = blocks.value;
      parts.push(el("h3", { textContent: "По часам" }, el("small", { cls: "muted", textContent: ` в плане ${v.plannedMinutes} мин, свободно ${v.remainingMinutes}` })),
        el("ol", { cls: "tasks-plan-list" }, ...v.blocks.map((b) => el("li", {}, el("span", { cls: "tasks-plan-time", textContent: hm(b.start) }), el("span", { cls: "grow", textContent: b.text }), el("span", { cls: "muted small", textContent: b.minutes + " мин" })))),
        el("p", { cls: "muted small", textContent: "Длительность берётся из поля «Минут» у дела, по умолчанию 30 минут, с 09:00 до 18:00." }));
    }
    dayHost.replaceChildren(...parts.filter((x): x is Node => !!x));
  }
  function renderGoals() {
    const title = el("input", { type: "text", maxLength: 500, cls: "mem-input", placeholder: "Новая цель", attrs: { "aria-label": "Новая цель" } });
    const create = iconButton("plus", "Создать цель", () => {}, "icon-btn");
    create.type = "submit";
    const form = el("form", { cls: "tasks-add-row tasks-goal-new" }, title, create);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!title.value.trim()) { title.focus(); return; }
      const r = await api.addMission(title.value.trim(), "");
      if (!r.ok) { showToast(r.error.message); return; }
      showToast("Цель создана");
      await load();
    });
    const cards = missions.filter((m) => m.status !== "complete").concat(missions.filter((m) => m.status === "complete")).map((m) => {
      const stage = el("input", { type: "text", maxLength: 500, cls: "mem-input", placeholder: "Следующий шаг", attrs: { "aria-label": "Новый шаг цели " + m.title } });
      const addBtn = iconButton("plus", "Добавить шаг", () => {}, "icon-btn sm");
      addBtn.type = "submit";
      const addStage = el("form", { cls: "tasks-add-row" }, stage, addBtn);
      addStage.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!stage.value.trim()) return;
        goalsSig = ""; // the step was added on purpose: redraw the goal with an empty field
        await act(() => api.addMissionStage(m.id, stage.value.trim()), "Шаг добавлен");
      });
      const status = el("select", { cls: "mem-select tasks-goal-status", attrs: { "aria-label": "Состояние цели " + m.title } }, ...([["active", "В работе"], ["paused", "Пауза"], ["complete", "Достигнута"]] as const).map(([value, label]) => el("option", { value, textContent: label })));
      status.value = m.status;
      status.addEventListener("change", () => void act(() => api.changeMissionStatus(m.id, status.value as Mission["status"])));
      return el("article", { cls: "tasks-goal" + (m.status !== "active" ? " " + m.status : "") },
        el("div", { cls: "tasks-goal-head" }, el("strong", { textContent: m.title }), status),
        el("div", { cls: "tasks-goal-bar" }, el("progress", { max: 100, value: m.percent, attrs: { "aria-label": "Прогресс цели " + m.title } }), el("span", { cls: "muted small", textContent: `${m.done}/${m.total}` })),
        m.next ? el("p", { cls: "muted small tasks-goal-next", textContent: "Дальше: " + m.next.text }) : null,
        m.status === "active" ? addStage : null);
    });
    goalsHost.replaceChildren(cardHead("Цели", el("small", { cls: "muted", textContent: "шаги — это дела с пометкой ◎" })),
      ...(cards.length ? cards : [el("p", { cls: "muted small", textContent: "Целей пока нет. Цель — большое дело из нескольких шагов." })]), form);
  }

  // ---------- toolbar and keys ----------
  const search = el("input", { type: "search", placeholder: "Поиск", value: UI.query, cls: "mem-search", attrs: { "aria-label": "Поиск по делам и заметкам" } });
  search.addEventListener("input", () => { UI.query = search.value; render(); });
  const perm = typeof Notification !== "undefined" && Notification.permission === "default"
    ? btn("Уведомления", async () => { await Notification.requestPermission(); perm?.remove(); }, { small: true, icon: "alert", title: "Показывать напоминания уведомлениями системы, даже когда вкладка свёрнута" }) : null;
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) { removeEventListener("keydown", onKey); return; }
    const tgt = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || app.get().chatOpen || (tgt && (tgt.closest("input,textarea,select,[contenteditable=true]")))) return;
    if (e.key === "n" || e.key === "т") { e.preventDefault(); text.focus(); }
    else if (e.key === "/") { e.preventDefault(); search.focus(); }
  };
  addEventListener("keydown", onKey);

  const root = el("div", { cls: "page tasks-page" },
    el("header", { cls: "pg-head tasks-head" }, el("div", { cls: "pg-head-text" }, el("h1", { textContent: "Дела" }), summary), perm),
    attHost,
    el("div", { cls: "tasks-layout" },
      el("div", { cls: "tasks-main" },
        el("section", { cls: "pg-card tasks-quick" }, form),
        el("div", { cls: "mem-toolbar" }, search, chipsHost),
        listHost,
        el("p", { cls: "muted small tasks-foot", textContent: "Напоминания срабатывают, пока JUUNIBI запущен. Клавиши: N — новое, / — поиск." })),
      el("aside", { cls: "tasks-side", attrs: { "aria-label": "Календарь и планы" } }, calHost, dayHost, goalsHost)));
  render();
  renderAttention(app.get());
  void load();
  return root;
}
