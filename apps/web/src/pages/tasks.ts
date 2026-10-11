/**
 * "Дела" — the start page: quick entry in one line, one timeline of to-dos and reminders by day,
 * notes; beside it (below on a phone) a calendar with the production calendar, the day plan and goals.
 */
import { api, type ArrangePlan, type AutoLogEntry, type AutoRule, type Automation, type DayLoad, type Note, type Reminder, type Repeat } from "../api";
import { el, icon, iconButton } from "../dom";
import { app, refreshBrief, type AppState, type Route } from "../state";
import { showToast } from "../toast";
import { buildAttention } from "./home";
import { achievementsPanel } from "./achievements-panel";
import { forecastWeek, simulateWeek } from "./weekly-forecast";
import { btn, chip, emptyState } from "./kit";
import { isWorkday, nextHoliday, nextLongRest, nextWorkday, prodDay, prodStats, type DayKind } from "@juunibi/core";
import kitsuneUrl from "../assets/kitsune.webp";
import { endOfDay, parseQuick, type QuickKind, type QuickParsed } from "./quick-entry";
import { REPEAT_LABEL, REPEAT_OPTIONS, buildTasks, daySummary, heroFallback, isDateOnly, localDay, memoryDates, planWeek, recognizedSpans, toLocalInput, weekProgress, type TaskFilter, type TimedItem } from "./tasks-model";

type Mission = { id: string; title: string; description: string; status: "active" | "paused" | "complete"; total: number; done: number; percent: number; blocked: number; idleDays?: number; next: { id: string; text: string; reason: string } | null; stages: { id: string; text: string; done: boolean }[] };
const KINDS: [QuickKind, string][] = [["auto", "Авто"], ["todo", "Дело"], ["reminder", "Напоминание"], ["note", "Заметка"]];
/** Kept across re-renders and visits: filter, search, the kind of the new entry, the calendar month and day. */
const UI = { filter: "all" as TaskFilter, query: "", kind: "auto" as QuickKind, month: "", day: "" };
/** Deletions waiting for their "Отменить" window to pass; hidden from the list meanwhile. */
const pendingDelete = new Set<string>();
const UNDO_MS = 6000;
/** Remembered in the browser: memory dates the owner turned down, the day the evening prompt was closed. */
const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode: forget it */ } },
};
const SKIP_DATES = "juunibi.tasks.skipDates", EVENING_SEEN = "juunibi.tasks.eveningSeen", FOLDED = "juunibi.tasks.folded", AUTO_TAB = "juunibi.tasks.autoTab", STUCK_SKIP = "juunibi.tasks.stuckSkip";
/** Side cards folded down to their title; «Автоматика» starts folded so the column stays short. */
const folded = new Set((store.get(FOLDED) ?? "auto").split(",").filter(Boolean));

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
/** Clickable examples on the empty list (the field's placeholder shows one more). */
const EXAMPLES = ["по будням в 9 стендап", "отчёт в пятницу !", "через час выпить воды", "заметка: код домофона 1234"];
const DRAG_TYPE = "text/x-juunibi-task";
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
export async function saveQuick(p: QuickParsed): Promise<{ ok: true; value: { id: string } } | { ok: false; error: { message: string } }> {
  if (p.kind === "reminder") return api.addReminder(p.text, p.at!, p.repeat);
  if (p.kind === "note") return api.addNote("note", p.text);
  const r = await api.addNote("todo", p.text);
  if (!r.ok || (!p.at && !p.priority && !p.project && !p.repeat)) return r;
  return api.updateTask(r.value.id, { ...(p.at ? { dueAt: p.dateOnly ? endOfDay(p.at) : p.at } : {}), ...(p.priority ? { priority: p.priority } : {}), ...(p.project ? { project: p.project } : {}), ...(p.repeat ? { repeat: p.repeat } : {}) });
}
/** The toast after `saveQuick`. */
export function savedText(p: QuickParsed): string {
  if (p.kind === "reminder") return "Напоминание: " + whenLabel(p.at!, false) + (p.repeat ? ", " + REPEAT_LABEL[p.repeat] : "");
  if (p.kind === "note") return "Заметка добавлена";
  return (p.at ? "Дело добавлено: срок " + whenLabel(p.at, !!p.dateOnly) : "Дело добавлено") + (p.repeat ? ", " + REPEAT_LABEL[p.repeat] : "");
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
  const forecastHost = el("section", { cls: "pg-card tasks-side-card tasks-forecast", attrs: { "aria-label": "Прогноз нагрузки на неделю" } });
  let scenarioMinutes = 0;
  const autoHost = el("section", { cls: "pg-card tasks-side-card tasks-auto", attrs: { "aria-label": "Автоматика" } });
  const datesHost = el("section", { cls: "pg-card tasks-side-card", attrs: { "aria-label": "Даты из памяти" } });
  const eveHost = el("div", { cls: "tasks-evening-host" });
  const heroHost = el("section", { cls: "tasks-hero", attrs: { "aria-label": "Сводка дня" } });
  /** «Дела и достижения» in the left column; the chosen title stands under the greeting. */
  const ach = achievementsPanel({
    open: (tab) => { if (tab) { try { localStorage.setItem("juunibi.ach.tab", tab); } catch { /* private mode */ } } deps.go("achievements"); },
    onTitle: () => { if (data) render(); },
  });
  let achTimer: ReturnType<typeof setTimeout> | undefined;
  let automation: Automation | null = null;
  /** How full today is (the hero's bar), and the «Разложить день» proposal for the selected day. */
  let todayLoad: DayLoad | null = null;
  let arrange: { day: string; plan: ArrangePlan | null; error?: string; picked: Set<string> } | null = null;
  /** The evening review is open (by the header button or the prompt after 18:00). */
  let evening = false;
  /** «Разбить на шаги»: the steps the assistant suggested, by to-do or goal id; null while it thinks. */
  const splits = new Map<string, { steps: string[] | null; error?: string }>();

  /** One request per month for the calendar and the day plan; a reload (after any change) asks again. */
  const insights = new Map<string, ReturnType<typeof api.taskInsights>>();
  const monthInsights = (month: string) => {
    let p = insights.get(month);
    if (!p) { p = api.taskInsights(month); insights.set(month, p); void p.then((r) => { if (!r.ok) insights.delete(month); }); }
    return p;
  };
  const load = async () => {
    insights.clear();
    const [r, m, a, l] = await Promise.all([api.organizer(), api.missions(), automation ? Promise.resolve(null) : api.automation(), api.dayLoad(localDay(new Date()))]);
    if (r.ok) { data = r.value; loadError = ""; } else loadError = r.error.message;
    todayLoad = l.ok ? l.value : null;
    if (autoLog) void loadLog();
    if (m.ok) missions = m.value;
    if (a?.ok) { automation = a.value; renderAuto(); }
    render();
    renderDates();
    void renderSide();
    // a change may have earned something: count again a moment later (several quick ticks give one recount)
    clearTimeout(achTimer);
    achTimer = setTimeout(() => ach.refresh(), 700);
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
  /** Gives a to-do the day `day`, keeping its own time of day; one without a time is due at the end of that day. */
  const moveToDay = (n: Note, day: string) => {
    const time = n.dueAt && !isDateOnly(n.dueAt) ? toLocalInput(n.dueAt).slice(11) : "23:59";
    const iso = fromLocal(`${day}T${time}`);
    if (iso) void act(() => api.updateTask(n.id, { dueAt: iso }), "Перенесено на " + whenLabel(iso, time === "23:59"));
  };
  const missionTitle = (id?: string) => (id ? missions.find((m) => m.id === id)?.title : undefined);

  // ---------- quick entry ----------
  const text = el("input", { type: "text", maxLength: 500, cls: "mem-input tasks-quick-input", placeholder: "Например: завтра в 10 позвонить маме", enterKeyHint: "done", attrs: { "aria-label": "Новое дело, напоминание или заметка", "aria-describedby": "tasks-preview" } });
  const preview = el("div", { cls: "tasks-preview", id: "tasks-preview", attrs: { "aria-live": "polite" } });
  /** Over the field: the words the parser understood («завтра в 10») get a soft highlight. */
  const mirror = el("div", { cls: "tasks-quick-mirror", attrs: { "aria-hidden": "true" } });
  const field = el("div", { cls: "tasks-quick-field" }, text, mirror);
  let mirrorStyled = false;
  const paintMirror = (spans: [number, number][]) => {
    if (!spans.length) { mirror.replaceChildren(); return; }
    if (!mirrorStyled) {
      const cs = getComputedStyle(text);
      Object.assign(mirror.style, { font: cs.font, letterSpacing: cs.letterSpacing, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, borderLeftWidth: cs.borderLeftWidth, borderRightWidth: cs.borderRightWidth });
      mirrorStyled = true;
    }
    const v = text.value, out: Node[] = [];
    let at = 0;
    for (const [a, b] of spans) { out.push(document.createTextNode(v.slice(at, a)), el("mark", { textContent: v.slice(a, b) })); at = b; }
    out.push(document.createTextNode(v.slice(at)));
    mirror.replaceChildren(el("span", {}, ...out));
    mirror.scrollLeft = text.scrollLeft;
  };
  text.addEventListener("scroll", () => { mirror.scrollLeft = text.scrollLeft; });
  const hint = el("div", { cls: "tasks-hint small" });
  /** The date moved to the next working day by the hint's button; typing clears it. */
  let shiftAt: string | null = null;
  const at = el("input", { type: "datetime-local", cls: "mem-select", attrs: { "aria-label": "Когда напомнить" } });
  const repeat = repeatSelect(undefined, "Повтор");
  const when_ = el("div", { cls: "tasks-when" }, at, repeat);
  /** The date field was changed by hand: typing no longer overwrites it. */
  let manualWhen = false;
  at.addEventListener("input", () => { manualWhen = true; });
  repeat.addEventListener("change", () => { manualWhen = true; });
  const add = btn("Добавить", () => {}, { primary: true, icon: "plus" });
  add.type = "submit";
  const kinds = el("select", { cls: "mem-select tasks-kind", title: "Что добавить: «Авто» понимает само по тексту", attrs: { "aria-label": "Что добавить" } }, ...KINDS.map(([k, label]) => el("option", { value: k, textContent: label })));
  kinds.addEventListener("change", () => { UI.kind = kinds.value as QuickKind; manualWhen = false; shiftAt = null; syncKind(); syncQuick(); text.focus(); });
  const whenRow = el("div", { cls: "tasks-add-row tasks-add-opts" }, when_);
  const parsed = (): QuickParsed => { const p = parseQuick(text.value, new Date(), UI.kind); return shiftAt && p.at ? { ...p, at: shiftAt } : p; };
  const syncQuick = () => {
    const p = parsed();
    // the date fields appear when a reminder is wanted but the text has no time: fill them in by hand
    const needWhen = p.kind === "reminder" && (UI.kind === "reminder" || !p.at);
    when_.hidden = whenRow.hidden = !needWhen;
    if (needWhen && !manualWhen) {
      at.value = toLocalInput(p.at ?? new Date(Date.now() + 3_600_000).toISOString()).slice(0, 14) + (p.at ? toLocalInput(p.at).slice(14) : "00");
      repeat.value = p.repeat ?? "none";
    }
    // a date on a weekend or a holiday: offer the nearest working day
    const pd = !needWhen && p.at && !p.repeat && p.kind !== "note" ? prodDay(localDay(p.at)) : null;
    if (pd && pd.kind !== "work" && pd.kind !== "short") {
      const to = nextWorkday(new Date(p.at!)).toISOString();
      hint.replaceChildren(el("span", { textContent: `${whenLabel(p.at!, true)[0]!.toUpperCase() + whenLabel(p.at!, true).slice(1)}: ${DAY_KIND[pd.kind].toLowerCase()}${pd.note ? " (" + pd.note + ")" : ""}.` }),
        btn("На рабочий день, " + whenLabel(to, true), () => { shiftAt = to; syncQuick(); text.focus(); }, { small: true }));
      hint.hidden = false;
    } else { hint.replaceChildren(); hint.hidden = true; }
    // the placeholder is the only hint: nothing under an empty field
    const typed = !!text.value.trim();
    preview.hidden = !typed;
    preview.replaceChildren(...(typed ? describeQuick(needWhen && at.value ? withWhen(p, fromLocal(at.value), repeat.value) : p).split(" · ").map((x, i) =>
      el("span", { cls: "tasks-pv" + (i ? "" : " kind"), textContent: x, ...(i === 0 && p.kind === "reminder" ? { title: "Напоминания срабатывают, пока JUUNIBI запущен" } : {}) })) : []));
    paintMirror(typed ? recognizedSpans(text.value, p.text) : []);
  };
  const syncKind = () => { kinds.value = UI.kind; kinds.classList.toggle("on", UI.kind !== "auto"); };
  text.addEventListener("input", () => { shiftAt = null; syncQuick(); });
  syncKind(); syncQuick();
  const form = el("form", { cls: "tasks-add" }, el("div", { cls: "tasks-add-row" }, field, kinds, add), preview, hint, whenRow);
  /** Puts `v` into the quick-entry field, ready to finish and press Enter. */
  const prefill = (v: string) => { text.value = v; shiftAt = null; manualWhen = false; syncQuick(); text.focus(); text.setSelectionRange(v.length, v.length); form.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
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
    if (ok) { text.value = ""; manualWhen = false; shiftAt = null; syncQuick(); text.focus(); }
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
    const rep = repeatSelect(n.repeat, "Повтор");
    const save = btn("Сохранить", async () => {
      const t = input.value.trim();
      if (!t) { input.focus(); return; }
      save.disabled = true;
      const minutes = estimate.value ? Math.min(1440, Math.max(1, Math.round(Number(estimate.value)))) : null;
      const ok = await act(async () => {
        if (t !== n.text) { const r = await api.editNote(n.id, t); if (!r.ok) return r; }
        return api.updateTask(n.id, { dueAt: due.value ? fromLocal(due.value) : null, priority: priority.value as NonNullable<Note["priority"]>, estimateMinutes: Number.isFinite(minutes) ? minutes : null,
          ...(rep.value !== (n.repeat ?? "none") ? { repeat: rep.value as Repeat | "none" } : {}), ...(mission ? {} : { project: project.value.trim() || null }), ...(hasKids ? {} : { parentId: parent.value || null }) });
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
        el("label", {}, el("span", { textContent: "Повтор" }), rep),
        el("label", {}, el("span", { textContent: "Входит в" }), parent)),
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

  // ---------- «Разбить на шаги» ----------
  const startSplit = async (key: string, task: string, redraw: () => void) => {
    splits.set(key, { steps: null });
    redraw();
    const r = await api.splitTask(task);
    if (!splits.has(key)) return; // closed while it was thinking
    splits.set(key, !r.ok ? { steps: null, error: r.error.message } : r.value.steps.length ? { steps: r.value.steps } : { steps: null, error: "Не получилось придумать шаги. Попробуйте описать дело подробнее." });
    redraw();
  };
  const stepsPanel = (key: string, redraw: () => void, addAll: (steps: string[]) => Promise<boolean>): HTMLElement | null => {
    const st = splits.get(key);
    if (!st) return null;
    const close = () => { splits.delete(key); redraw(); };
    if (!st.steps) return el("div", { cls: "tasks-split" + (st.error ? " error" : ""), attrs: { "aria-live": "polite" } },
      el("p", { cls: "small grow", textContent: st.error ?? "Ассистент разбивает на шаги…" }), iconButton("x", "Закрыть", close, "icon-btn sm"));
    const rows = st.steps.map((x) => ({ on: el("input", { type: "checkbox", checked: true, attrs: { "aria-label": "Взять шаг" } }), text: el("input", { type: "text", maxLength: 500, value: x, cls: "mem-input", attrs: { "aria-label": "Текст шага" } }) }));
    const ok = btn("Добавить шаги", async () => {
      const pick = rows.filter((x) => x.on.checked && x.text.value.trim()).map((x) => x.text.value.trim());
      if (!pick.length) { showToast("Отметьте хотя бы один шаг."); return; }
      ok.disabled = true;
      if (await addAll(pick)) splits.delete(key);
      else ok.disabled = false;
      redraw();
    }, { small: true, primary: true });
    return el("div", { cls: "tasks-split" }, el("p", { cls: "small muted", textContent: "Шаги от ассистента: уберите лишнее или поправьте текст." }),
      el("ol", { cls: "tasks-split-list" }, ...rows.map((x) => el("li", {}, x.on, x.text))),
      el("div", { cls: "row" }, ok, btn("Отмена", close, { small: true })));
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
        n.rolled && !n.done ? el("span", { cls: "tasks-rolled", title: `Не сделано вовремя, перенесено автоматически (${n.rolled} раз)`, textContent: "перенесено" + (n.rolled > 1 ? " ×" + n.rolled : "") }) : null,
        n.repeat ? "↻ " + REPEAT_LABEL[n.repeat] : null,
        n.repeat && !n.done && automation?.streaks !== false && (n.streak ?? 0) >= 2 ? el("span", { cls: "tasks-streak", title: `Сделано вовремя ${n.streak} раз подряд`, textContent: "🔥 " + n.streak }) : null,
        kids.length ? `шаги ${doneKids}/${kids.length}` : null,
        n.estimateMinutes ? n.estimateMinutes + " мин" : null,
        mission ? "◎ " + mission : n.project ? "#" + n.project : null,
        n.done && n.completedAt ? "сделано " + whenLabel(n.completedAt, false) : null)),
      n.done ? null : star,
      n.done || n.parentId ? null : iconButton("spark", "Разбить на шаги: " + n.text, () => void startSplit(n.id, n.text, render), "icon-btn sm"),
      n.done ? null : iconButton("edit", "Изменить: " + n.text, () => { editing = n.id; render(); }, "icon-btn sm"),
      iconButton("trash", "Удалить: " + n.text, () => removeLater(n.id, kids.length ? `Дело удалено, его шаги (${kids.length}) стали отдельными делами` : "Дело удалено", () => api.removeNote(n.id)), "icon-btn sm"));
    const panel = stepsPanel(n.id, render, (steps) => act(async () => {
      for (const x of steps) {
        const r = await api.addNote("todo", x);
        if (!r.ok) return r;
        const u = await api.updateTask(r.value.id, { parentId: n.id });
        if (!u.ok) return u;
      }
      return { ok: true };
    }, `Добавлено шагов: ${steps.length}`));
    if (!n.done) {
      // drag a to-do onto a day of the calendar to move it there
      row.draggable = true;
      row.addEventListener("dragstart", (e) => { if (!e.dataTransfer) return; e.dataTransfer.setData(DRAG_TYPE, n.id); e.dataTransfer.effectAllowed = "move"; root.classList.add("tasks-dragging"); });
      row.addEventListener("dragend", () => root.classList.remove("tasks-dragging"));
    }
    const stuck = !n.done && automation?.stuckAfter && (n.rolled ?? 0) >= automation.stuckAfter && !stuckSkip().has(n.id + "@" + n.rolled) ? stuckStrip(n) : null;
    if (stuck) row.classList.add("stuck");
    if (!kids.length && !panel && !stuck) return row;
    return el("li", { cls: "tasks-parent" }, el("ul", { cls: "org-list" }, row), stuck, panel,
      kids.length ? el("ul", { cls: "org-list tasks-children" }, ...kids.filter((k) => !pendingDelete.has(k.id)).map((k) => todoRow(k))) : null);
  };
  const stuckSkip = () => new Set((store.get(STUCK_SKIP) ?? "").split(",").filter(Boolean));
  /** Under a to-do moved too many times: what to do with it. */
  const stuckStrip = (n: Note): HTMLElement => el("div", { cls: "tasks-stuck", attrs: { role: "group", "aria-label": "Застрявшее дело" } },
    el("span", { cls: "grow small" }, el("b", { textContent: "Застряло. " }), `Перенесено ${n.rolled} ${n.rolled! % 10 >= 2 && n.rolled! % 10 <= 4 && (n.rolled! % 100 < 12 || n.rolled! % 100 > 14) ? "раза" : "раз"}. Что с ним сделать?`),
    n.parentId ? null : btn("На шаги", () => void startSplit(n.id, n.text, render), { small: true, icon: "spark" }),
    btn("Новая дата", () => { editing = n.id; render(); }, { small: true, icon: "calendar" }),
    btn("Без срока", () => void act(() => api.updateTask(n.id, { dueAt: null }), "Срок снят, дело — в «Без срока»"), { small: true }),
    btn("Удалить", () => removeLater(n.id, "Дело удалено", () => api.removeNote(n.id)), { small: true }),
    iconButton("x", "Оставить как есть", () => { const s = stuckSkip(); s.add(n.id + "@" + n.rolled); store.set(STUCK_SKIP, [...s].slice(-100).join(",")); render(); }, "icon-btn sm"));
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
      el("option", { value: "60", textContent: "на час" }), el("option", { value: "180", textContent: "на 3 часа" }), el("option", { value: "tomorrow", textContent: "до завтра" }));
    snooze.addEventListener("change", () => {
      if (snooze.value === "tomorrow") { void act(() => api.snoozeReminder(r.id, "tomorrow"), "Напомню завтра в " + (automation?.briefTime ?? "09:00")); return; }
      const m = Number(snooze.value); if (m) void act(() => api.snoozeReminder(r.id, m), "Напомню " + whenLabel(new Date(Date.now() + m * 60_000).toISOString(), false));
    });
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
    renderTop(t);
    const c = t.counts;
    const opts: [TaskFilter, string, number][] = [["all", "Все", c.all], ["todo", "Дела", c.todo], ["reminder", "Напоминания", c.reminder], ["note", "Заметки", c.note]];
    chipsHost.replaceChildren(...opts.map(([f, label, n]) => chip(label, n, UI.filter === f, () => { UI.filter = f; render(); })));
    // with nothing at all, filters full of zeros and a search over nothing only get in the way
    toolbar.hidden = !c.all && !UI.query && UI.filter === "all";
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
        : emptyState("check", "Дел пока нет", "Нажмите на пример, он подставится в поле выше. В чате тоже можно: «напоминай по будням в 10 про стендап».",
            el("div", { cls: "tasks-examples" }, ...EXAMPLES.map((x) => el("button", { type: "button", cls: "chip", textContent: x, onclick: () => prefill(x) })))));
      return;
    }
    listHost.replaceChildren(...groups, ...(done ? [done] : []));
  }
  function renderTop(t: ReturnType<typeof buildTasks>) {
    const parts: HTMLElement[] = [];
    renderHero(t);
    const today = localDay(new Date());
    const sum = data ? daySummary(data.notes) : { done: [], open: [] };
    const eveAt = automation?.evening ? Math.min(18, Number(automation.eveningTime.slice(0, 2))) : 18;
    const wp = weekPlanCard();
    if (wp) parts.push(wp);
    if (evening) parts.push(eveningCard(sum));
    else if (new Date().getHours() >= eveAt && sum.open.length && store.get(EVENING_SEEN) !== today) {
      parts.push(el("div", { cls: "attn-row info tasks-evening-ask" }, icon("moon", 18),
        el("span", { cls: "grow", textContent: `Вечер. На сегодня не сделано: ${sum.open.length}` + (sum.done.length ? `, сделано: ${sum.done.length}.` : ".") }),
        btn("Подвести итог", () => { evening = true; render(); }, { small: true, primary: true }),
        iconButton("x", "Не сегодня", () => { store.set(EVENING_SEEN, today); render(); }, "icon-btn sm")));
    }
    if (t.week && UI.filter === "all" && !UI.query) {
      const w = t.week;
      parts.push(el("section", { cls: "pg-card tasks-week", attrs: { "aria-label": "Обзор недели" } },
        el("div", { cls: "tasks-brief-head" }, icon("calendar", 18), el("strong", { cls: "grow", textContent: "Обзор недели" }), el("small", { cls: "muted", textContent: whenLabel(w.createdAt, false) }),
          iconButton("x", "Скрыть обзор недели", () => removeLater(w.id, "Обзор скрыт", () => api.removeNote(w.id)), "icon-btn sm")),
        el("ul", { cls: "tasks-week-lines" }, ...w.text.split("\n").slice(1).map((x) => el("li", { textContent: x })))));
    }
    eveHost.replaceChildren(...parts);
  }
  /** «Завтра праздник» with its to-dos, so they can be moved to a working day before it comes. */
  function tomorrowNotice(): HTMLElement | null {
    if (!automation?.holidayWarn || !data) return null;
    const now = new Date(), key = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const pd = prodDay(key);
    if (!pd || (pd.kind !== "holiday" && pd.kind !== "off" && pd.kind !== "short")) return null;
    const due = data.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && localDay(n.dueAt) === key);
    const what = pd.kind === "short" ? "Завтра сокращённый день, на час короче" : `Завтра ${pd.kind === "holiday" ? "праздник" + (pd.note ? ": " + pd.note : "") : "выходной (перенос)"}`;
    return el("div", { cls: "tasks-hero-note " + pd.kind }, icon("calendar", 16),
      el("span", { cls: "grow", textContent: what + (due.length ? `. Дел на завтра: ${due.length}.` : ".") }),
      due.length && pd.kind !== "short" ? btn("На рабочий день", () => void act(() => api.moveTasks(due.map((n) => n.id), "workday"), `Перенесено на рабочий день: ${due.length}`), { small: true }) : null);
  }
  /** Today's load: minutes of to-dos against the free hours, and a way out when it is too much. */
  function loadBar(): HTMLElement | null {
    const l = todayLoad;
    if (!l || !automation?.dayHours || !l.count) return null;
    const pct = Math.min(100, Math.round((100 * l.planned) / Math.max(1, l.capacity)));
    const h = (m: number) => (Math.round(m / 6) / 10).toLocaleString("ru-RU") + " ч";
    const bar = el("div", { cls: "tasks-load-bar", attrs: { role: "meter", "aria-valuemin": "0", "aria-valuemax": String(l.capacity), "aria-valuenow": String(l.planned), "aria-label": "Загрузка дня" } }, el("i"));
    bar.style.setProperty("--p", String(pct));
    return el("div", { cls: "tasks-load" + (l.over ? " over" : pct >= 80 ? " full" : "") },
      el("div", { cls: "tasks-load-top" }, el("span", { cls: "grow", textContent: l.over ? `Перегруз: дел на ${h(l.planned)} при ${h(l.capacity)}` : `Загрузка: ${h(l.planned)} из ${h(l.capacity)}` }),
        l.over && l.move.length ? btn(`Перенести лишнее (${l.move.length})`, () => void act(() => api.moveTasks(l.move.map((x) => x.id), "workday"), `На следующий рабочий день: ${l.move.map((x) => x.text).join(", ").slice(0, 80)}`), { small: true, title: "Сдвинуть на следующий рабочий день: " + l.move.map((x) => x.text).join(", ") }) : null),
      bar);
  }
  /** The wide card on top: greeting, the kind of day, today's progress ring and counters, and the brief (or the evening summary). */
  function renderHero(t: ReturnType<typeof buildTasks>) {
    const now = new Date(), h = now.getHours();
    const hello = h >= 5 && h < 12 ? "Доброе утро" : h >= 12 && h < 17 ? "Добрый день" : h >= 17 && h < 23 ? "Добрый вечер" : "Доброй ночи";
    const pd = prodDay(localDay(now));
    const s = t.summary;
    const total = s.doneToday + s.today + s.overdue;
    const pct = total ? Math.round((100 * s.doneToday) / total) : 0;
    const date = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    // an empty day: the ring shows the week instead, and a sleeping kitsune when the week is empty too
    const wk = total ? null : weekProgress(data?.notes ?? [], now);
    const wpct = wk?.total ? Math.round((100 * wk.done) / wk.total) : 0;
    const ring = total || wk?.total
      ? el("div", { cls: "tasks-ring" + ((total ? pct : wpct) === 100 ? " full" : "") + (total ? "" : " week"), title: total ? `Сделано ${s.doneToday} из ${total} на сегодня` : `За неделю сделано ${wk!.done} из ${wk!.total}`, attrs: { role: "img", "aria-label": total ? `Сделано ${pct}% дел на сегодня` : `Сделано ${wpct}% дел недели` } },
          el("span", { cls: "tasks-ring-num", textContent: (total ? pct : wpct) + "%" }), el("small", { textContent: total ? `${s.doneToday} из ${total}` : `${wk!.done} из ${wk!.total} за неделю` }))
      : el("div", { cls: "tasks-ring rest", title: "На этой неделе дел со сроком нет" }, el("span", { cls: "tasks-ring-fox", attrs: { "aria-hidden": "true", style: `background-image:url("${kitsuneUrl}")` } }), el("small", { textContent: "неделя свободна" }));
    ring.style.setProperty("--p", String(total ? pct : wpct));
    const stat = (n: number, label: string, tone: string, run?: () => void) => {
      const b = el("button", { type: "button", cls: "tasks-stat " + tone + (n ? "" : " zero") }, el("b", { textContent: String(n) }), el("span", { textContent: label }));
      if (run) b.addEventListener("click", run); else b.disabled = true;
      return b;
    };
    const jump = (cls: string) => () => listHost.querySelector(`.tasks-group.${cls}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const clean = UI.filter === "all" && !UI.query;
    // after the evening summary is written, it takes the brief's place
    const b = clean ? t.evening ?? t.brief : undefined;
    const isEve = !!b && b === t.evening;
    const dayOff = !!pd && pd.kind !== "work" && pd.kind !== "short";
    const tKey = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrowTodos = data?.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && localDay(n.dueAt) === tKey).sort((x, y) => x.dueAt!.localeCompare(y.dueAt!)) ?? [];
    const fb = heroFallback({ now, brief: !!automation?.brief, briefTime: automation?.briefTime ?? "09:00", evening: !!automation?.evening, eveningTime: automation?.eveningTime ?? "21:00", dayOff,
      done: s.doneToday, left: s.today + s.overdue, tomorrow: tomorrowTodos.length, ...(tomorrowTodos[0] ? { tomorrowFirst: tomorrowTodos[0].text } : {}) });
    const eveMode = isEve || (!b && fb.evening);
    const kind = pd ? el("span", { cls: "tasks-daykind " + pd.kind, textContent: pd.kind === "holiday" && pd.note ? pd.note : DAY_KIND[pd.kind] }) : null;
    // the brief's time, «again» and «hide» live in one small menu instead of a row of their own
    const menu = el("details", { cls: "tasks-hero-menu" });
    const item = (label: string, ic: Parameters<typeof icon>[0], run: () => void) => { const x = btn(label, () => { menu.open = false; run(); }, { small: true, icon: ic }); return x; };
    menu.append(el("summary", { title: "Сводка: ещё", attrs: { "aria-label": "Сводка: ещё" } }, icon("more", 18)),
      el("div", { cls: "tasks-hero-menu-list" },
        b ? el("small", { cls: "muted", textContent: (isEve ? "Итог составлен в " : "Сводка составлена в ") + hm(b.createdAt) }) : null,
        item(eveMode ? (b ? "Подвести итог заново" : "Подвести итог сейчас") : b ? "Составить сводку заново" : "Составить сводку сейчас", "refresh",
          () => void act(() => (eveMode ? api.runEvening() : api.runBrief()), eveMode ? "Итог дня готов" : "Сводка готова")),
        b ? item(isEve ? "Скрыть итог дня" : "Скрыть сводку", "eyeOff", () => removeLater(b.id, isEve ? "Итог скрыт" : "Сводка скрыта", () => api.removeNote(b.id))) : null));
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      const close = (e: Event) => { if (!menu.contains(e.target as Node)) { menu.open = false; document.removeEventListener("pointerdown", close); } };
      document.addEventListener("pointerdown", close);
    });
    // Sunday: spread the to-dos without a date over the coming week
    const undated = data?.notes.some((n) => n.kind === "todo" && !n.done && !n.dueAt && !n.parentId) ?? false;
    const planBtn = now.getDay() === 0 && undated && !weekPlan ? btn("Спланировать неделю", () => openWeekPlan(), { small: true, icon: "calendar", title: "Разложить дела без срока по рабочим дням недели" }) : null;
    heroHost.classList.toggle("evening", eveMode);
    heroHost.classList.toggle("quiet", !total);
    heroHost.replaceChildren(
      el("div", { cls: "tasks-hero-main" },
        el("div", { cls: "tasks-hero-top" }, el("span", { cls: "tasks-hero-ic", attrs: { "aria-hidden": "true" } }, icon(h >= 17 || h < 5 ? "moon" : "sun", 22)),
          el("div", { cls: "grow" }, el("strong", { cls: "tasks-hero-hello", textContent: hello }), el("span", { cls: "tasks-hero-date" }, date[0]!.toUpperCase() + date.slice(1), kind, ach.title() ? el("button", { type: "button", cls: "ach-title-chip", textContent: ach.title()!, title: "Титул из «Дел и достижений»", onclick: () => deps.go("achievements") }) : null)),
          menu),
        b ? el("p", { cls: "tasks-hero-text" + (isEve ? " eve" : ""), textContent: briefBody(b.text, isEve) })
          : el("p", { cls: "tasks-hero-text muted", textContent: fb.text }),
        tomorrowNotice(),
        loadBar(),
        total
          ? el("div", { cls: "tasks-hero-stats" },
              stat(s.today, "на сегодня", "today", s.today ? jump("today") : undefined),
              stat(s.overdue, "просрочено", "late", s.overdue ? jump("late") : undefined),
              stat(s.doneToday, "сделано", "done"),
              el("span", { cls: "grow" }),
              planBtn,
              eveMode && (s.today + s.overdue) ? btn("Итог дня", () => { evening = true; render(); }, { small: true, icon: "moon" }) : null)
          : el("div", { cls: "tasks-hero-stats is-empty" },
              el("span", { cls: "tasks-hero-none", textContent: "Дел на сегодня нет" }),
              el("span", { cls: "grow" }),
              planBtn,
              btn("Запланировать завтра", () => prefill("завтра "), { small: true, icon: "plus", primary: !planBtn }))),
      ring);
  }
  /**
   * The brief without what the header already says: an old brief may still open with the date and the kind of day
   * («Воскресенье, 11 октября — выходной.») or a greeting; the evening one drops its «Итог дня: …» line.
   */
  function briefBody(text: string, eve: boolean): string {
    if (eve) return text.split("\n").slice(1).join("\n");
    return text.replace(/^(?:(?:доброе утро|добрый день|добрый вечер|доброй ночи|привет)[!,.]?\s*)/iu, "")
      .replace(/^(?:сегодня\s+)?[а-яё]+,\s+\d{1,2}\s+[а-яё]+\s*(?:—|-|–)\s*[^.\n]*[.\n]\s*/iu, "").replace(/^./, (c) => c.toUpperCase()) || text;
  }
  /** «Спланировать неделю»: the proposal, a tick for each to-do, one button to apply. */
  let weekPlan: { id: string; text: string; day: string; on: boolean }[] | null = null;
  function openWeekPlan() {
    const days: string[] = [];
    const d = new Date(); d.setHours(12, 0, 0, 0);
    for (let i = 0; i < 14 && days.length < 5; i++) { d.setDate(d.getDate() + 1); if (isWorkday(d)) days.push(localDay(d)); }
    const plan = planWeek(data?.notes ?? [], days, Math.round((automation?.dayHours || 8) * 60));
    if (!plan.length) { showToast("Свободных окон на неделе не нашлось."); return; }
    weekPlan = plan.map((x) => ({ ...x, on: true }));
    render();
    eveHost.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function weekPlanCard(): HTMLElement | null {
    const plan = weekPlan;
    if (!plan) return null;
    const close = () => { weekPlan = null; render(); };
    const dayName = (k: string) => new Date(k + "T12:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
    const apply = btn("Разложить отмеченное", async () => {
      const pick = plan.filter((x) => x.on);
      if (!pick.length) { showToast("Ничего не отмечено."); return; }
      apply.disabled = true;
      const ok = await act(async () => {
        for (const x of pick) { const r = await api.updateTask(x.id, { dueAt: fromLocal(x.day + "T23:59")! }); if (!r.ok) return r; }
        return { ok: true };
      }, `Разложено на неделю: ${pick.length}`);
      if (ok) close(); else apply.disabled = false;
    }, { small: true, primary: true, icon: "calendar" });
    return el("section", { cls: "pg-card tasks-evening tasks-weekplan", attrs: { "aria-label": "План недели" } },
      el("div", { cls: "tasks-brief-head" }, icon("calendar", 18), el("strong", { cls: "grow", textContent: "План недели" }), iconButton("x", "Закрыть план недели", close, "icon-btn sm")),
      el("p", { cls: "small muted", textContent: "Дела без срока по рабочим дням, важные первыми, не больше свободных часов дня. Снимите галочку, если не нужно." }),
      el("ul", { cls: "tasks-evening-open" }, ...plan.map((x) => {
        const box = el("input", { type: "checkbox", checked: x.on, attrs: { "aria-label": "Запланировать: " + x.text } });
        box.addEventListener("change", () => { x.on = box.checked; });
        return el("li", {}, el("label", { cls: "grow" }, box, el("span", { textContent: x.text })), el("small", { cls: "muted", textContent: dayName(x.day) }));
      })),
      el("div", { cls: "row" }, apply));
  }
  /** «Итог дня»: done today, and what is left for today with one button to move it to tomorrow. */
  function eveningCard(sum: { done: Note[]; open: Note[] }): HTMLElement {
    const close = () => { evening = false; store.set(EVENING_SEEN, localDay(new Date())); render(); };
    const rows = sum.open.map((n) => ({ n, box: el("input", { type: "checkbox", checked: true, attrs: { "aria-label": "Перенести на завтра: " + n.text } }) }));
    const move = btn("Перенести отмеченное на завтра", async () => {
      const pick = rows.filter((x) => x.box.checked).map((x) => x.n);
      if (!pick.length) { showToast("Ничего не отмечено."); return; }
      move.disabled = true;
      const ok = await act(() => api.moveTasks(pick.map((n) => n.id), "tomorrow"), `Перенесено на завтра: ${pick.length}`);
      if (ok) close(); else move.disabled = false;
    }, { small: true, primary: true, icon: "arrowDown" });
    return el("section", { cls: "pg-card tasks-evening", attrs: { "aria-label": "Итог дня" } },
      el("div", { cls: "tasks-brief-head" }, icon("moon", 18), el("strong", { cls: "grow", textContent: "Итог дня" }), iconButton("x", "Закрыть итог дня", close, "icon-btn sm")),
      el("p", { cls: "small", textContent: sum.done.length ? `Сделано сегодня: ${sum.done.length}` : "Сегодня пока ничего не отмечено сделанным." }),
      sum.done.length ? el("ul", { cls: "tasks-evening-done" }, ...sum.done.map((n) => el("li", { textContent: n.text }))) : null,
      sum.open.length
        ? el("div", {}, el("p", { cls: "small", textContent: `Не успели: ${sum.open.length}. Отметьте, что перенести на завтра (время сохранится), или отметьте сделанным.` }),
            el("ul", { cls: "tasks-evening-open" }, ...rows.map(({ n, box }) => el("li", {}, el("label", { cls: "grow" }, box, el("span", { textContent: n.text }), el("small", { cls: "muted", textContent: " · " + whenLabel(n.dueAt!, isDateOnly(n.dueAt!)) })),
              iconButton("check", "Сделано: " + n.text, () => void act(() => api.setTodoDone(n.id, true), "Готово: " + n.text), "icon-btn sm")))),
            el("div", { cls: "row" }, move))
        : el("p", { cls: "small", textContent: "Всё, что было на сегодня, сделано. Хорошего вечера!" }));
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
    const ds = s.memory.map((m) => m.id + m.status).join();
    if (ds !== datesSig) { datesSig = ds; renderDates(); }
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
    renderForecast();
  }
  /** «Неделя вперёд»: the load of the next seven days and a «what if» for every working day. */
  function renderForecast() {
    const cap = Math.round((automation?.dayHours || 8) * 60);
    const scenario = simulateWeek(forecastWeek(data?.notes ?? [], new Date(), cap), scenarioMinutes);
    const days = scenario.days;
    const planned = days.reduce((n, f) => n + f.planned, 0), capacity = days.reduce((n, f) => n + f.capacity, 0);
    const h = (m: number) => (Math.round(m / 6) / 10).toLocaleString("ru-RU") + " ч";
    const whatIf = el("div", { cls: "tasks-scenario-controls", attrs: { role: "group", "aria-label": "Что если добавлять работу в будни" } },
      el("span", { cls: "muted small", title: "Сколько работы добавить в каждый рабочий день: только прикидка, дела не меняются", textContent: "Что если в будни:" }),
      ...([30, 60, 120] as const).map((minutes) => {
        const on = scenarioMinutes === minutes;
        const b = el("button", { type: "button", cls: "chip" + (on ? " on" : ""), textContent: minutes < 60 ? "+" + minutes + " мин" : "+" + minutes / 60 + " ч", attrs: { "aria-pressed": String(on) } });
        b.addEventListener("click", () => { scenarioMinutes = on ? 0 : minutes; renderForecast(); });
        return b;
      }));
    forecastHost.replaceChildren(
      cardHead(forecastHost, "forecast", "Неделя вперёд", el("small", { cls: "muted tasks-forecast-total", title: "Оценка по срокам дел: без указанной длительности — 30 минут на дело. Свободных часов в рабочий день берётся из «Автоматики», выходные и праздники без рабочих часов. Сценарий «что если» ничего не меняет в делах.", textContent: `${h(planned)} из ${h(capacity)} ⓘ` })),
      el("div", { cls: "tasks-forecast-list" }, ...days.map((f) => {
        const d = new Date(f.day + "T12:00");
        const off = !f.capacity;
        const label = d.toLocaleDateString("ru-RU", { weekday: "short" });
        const row = el("div", { cls: "tasks-forecast-day" + (f.overload && !off ? " overload" : "") + (off ? " off" : ""), title: `${f.count} дел · ${h(f.planned)}` + (f.overload && !off ? `, перегруз на ${h(f.excess)}` : "") },
          el("time", { attrs: { datetime: f.day }, textContent: label[0]!.toUpperCase() + label.slice(1) + " " + d.getDate() }),
          el("span", { cls: "tasks-forecast-track" }, el("i")),
          el("small", { textContent: off && !f.planned ? "вых." : f.planned ? h(f.planned) : "—" }));
        (row.querySelector(".tasks-forecast-track i") as HTMLElement).style.width = Math.min(100, f.capacity ? 100 * f.planned / f.capacity : f.planned ? 100 : 0) + "%";
        return row;
      })),
      whatIf,
      ...(scenarioMinutes ? [el("p", { cls: "small muted", textContent: `Сценарий: ещё ${h(scenario.extra)} за неделю, перегруженных дней: ${scenario.overloadedDays}. Дела не меняются.` })] : []));
  }
  /** A side card's title; clicking it folds the card to one line (remembered in the browser). */
  const cardHead = (host: HTMLElement, key: string, title: string, ...extra: (Node | null)[]) => {
    const isFolded = folded.has(key);
    host.classList.toggle("folded", isFolded);
    const toggle = el("button", { type: "button", cls: "tasks-fold", attrs: { "aria-expanded": String(!isFolded), title: isFolded ? "Развернуть" : "Свернуть" } }, el("span", { textContent: title }), icon("chevron", 16));
    toggle.addEventListener("click", () => {
      if (folded.has(key)) folded.delete(key); else folded.add(key);
      store.set(FOLDED, [...folded].join(","));
      const now = folded.has(key);
      host.classList.toggle("folded", now);
      toggle.setAttribute("aria-expanded", String(!now));
      toggle.title = now ? "Развернуть" : "Свернуть";
    });
    return el("div", { cls: "tasks-side-head" }, el("h2", {}, toggle), ...extra);
  };
  const shiftMonth = (n: number) => { const [y, m] = UI.month.split("-").map(Number); const d = new Date(y!, m! - 1 + n, 1); UI.month = localDay(d).slice(0, 7); void renderCalendar(); };
  /** Selects a day; a day of another month turns the calendar to that month. Keeps the keyboard focus on the grid. */
  const pickDay = (key: string, focus = false) => {
    UI.day = key;
    if (key.slice(0, 7) !== UI.month) UI.month = key.slice(0, 7);
    void Promise.all([renderCalendar(), renderDay()]).then(() => { if (focus) calHost.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus(); });
  };
  const addDaysKey = (key: string, n: number) => { const d = new Date(key + "T12:00"); d.setDate(d.getDate() + n); return localDay(d); };
  const dayWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "дня" : "дней");
  const calTip = el("div", { cls: "tasks-cal-tip", attrs: { role: "tooltip" } });
  calTip.hidden = true;
  let calSwipe: number | null = null;
  async function renderCalendar() {
    const r = await monthInsights(UI.month);
    const [y, mo] = UI.month.split("-").map(Number);
    const first = new Date(y!, mo! - 1, 1);
    const title = first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
    const todayKey = localDay(new Date());
    const atToday = UI.month === todayKey.slice(0, 7) && UI.day === todayKey;
    const nav = el("div", { cls: "tasks-cal-nav" },
      iconButton("chevronLeft", "Предыдущий месяц (PageUp)", () => shiftMonth(-1), "icon-btn sm"),
      atToday ? null : btn("Сегодня", () => pickDay(todayKey), { small: true }),
      iconButton("chevronRight", "Следующий месяц (PageDown)", () => shiftMonth(1), "icon-btn sm"));
    const head = cardHead(calHost, "cal", title[0]!.toUpperCase() + title.slice(1), nav);
    if (!r.ok) { calHost.replaceChildren(head, el("p", { cls: "muted small", textContent: "Календарь недоступен: " + r.error.message })); return; }
    const items = r.value.items;
    const heavy = new Set(r.value.heavyDays ?? []);
    const byDay = new Map<string, typeof items>();
    for (const it of items) { const k = localDay(it.at); byDay.set(k, [...(byDay.get(k) ?? []), it]); }
    // birthdays and other yearly reminders: a star on their day
    const yearly = new Map<string, string[]>();
    for (const rem of data?.reminders ?? []) if (rem.repeat === "yearly" && rem.status === "scheduled") { const md = localDay(rem.at).slice(5); yearly.set(md, [...(yearly.get(md) ?? []), rem.text]); }
    const seen = new Set<string>();
    const cell = (key: string, outside: boolean) => {
      const d = Number(key.slice(8));
      const list = outside ? [] : byDay.get(key) ?? [];
      const pd = prodDay(key);
      const open = list.filter((x) => !x.done && x.kind === "todo").length;
      const late = !outside && key < todayKey && open > 0;
      const stars = outside ? [] : yearly.get(key.slice(5)) ?? [];
      const special = pd && pd.kind !== "work" ? pd.kind : null;
      if (!outside) {
        if (special) seen.add(special);
        if (list.length) seen.add("dot");
        if (late) seen.add("late");
        if (stars.length) seen.add("star");
        if (heavy.has(key)) seen.add("heavy");
      }
      const label = `${d}${special ? ", " + DAY_KIND[special].toLowerCase() + (pd!.note ? " (" + pd!.note + ")" : "") : ""}` + (list.length ? `: записей ${list.length}` : "") + (late ? ", не сделано" : "") + (heavy.has(key) ? ", день перегружен" : "") + (stars.length ? ", " + stars.join(", ") : "");
      const heat = Math.min(4, list.length);
      const c = el("button", { type: "button", cls: "tasks-calendar-day" + (outside ? " outside" : "") + (special ? " " + special : "") + (heat ? " h" + heat : "") + (heavy.has(key) && !outside ? " heavy" : "") + (key === todayKey ? " today" : "") + (key === UI.day ? " selected" : ""),
        attrs: { "data-day": key, "aria-pressed": String(key === UI.day), "aria-label": label, tabindex: key === UI.day ? "0" : "-1" } },
        el("span", { cls: "tasks-calendar-num", textContent: String(d) }),
        list.length ? el("span", { cls: "tasks-calendar-dots", attrs: { "aria-hidden": "true" } }, ...list.slice(0, 3).map((x) => el("i", { cls: (x.done ? "done" : "") + (x.kind === "reminder" ? " rem" : "") }))) : null,
        list.length > 3 ? el("small", { cls: "tasks-calendar-more", attrs: { "aria-hidden": "true" }, textContent: "+" + (list.length - 3) }) : null,
        late ? el("i", { cls: "tasks-calendar-late", attrs: { "aria-hidden": "true" } }) : null,
        stars.length ? el("span", { cls: "tasks-calendar-star", attrs: { "aria-hidden": "true" }, textContent: "★" }) : null);
      c.addEventListener("click", () => pickDay(key));
      // double click: a new entry for that day in the quick-entry field
      c.addEventListener("dblclick", () => prefill(new Date(key + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) + " "));
      const tipLines = [...stars.map((x) => "★ " + x), ...list.slice(0, 5).map((x) => (x.done ? "✓ " : x.kind === "reminder" ? "◷ " : "• ") + (isDateOnly(x.at) ? "" : hm(x.at) + " ") + x.text), ...(list.length > 5 ? [`и ещё ${list.length - 5}`] : [])];
      if (tipLines.length || special) {
        const show = () => {
          calTip.replaceChildren(el("b", { textContent: new Date(key + "T12:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" }) + (special ? " · " + (pd!.note ?? DAY_KIND[special]) : "") }), ...tipLines.map((x) => el("span", { textContent: x })));
          calTip.hidden = false;
          const box = calHost.getBoundingClientRect(), at = c.getBoundingClientRect();
          calTip.style.top = at.bottom - box.top + 6 + "px";
          calTip.style.left = Math.max(8, Math.min(box.width - calTip.offsetWidth - 8, at.left - box.left + at.width / 2 - calTip.offsetWidth / 2)) + "px";
        };
        c.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(); });
        c.addEventListener("pointerleave", () => { calTip.hidden = true; });
        c.addEventListener("focus", () => { if (c.matches(":focus-visible")) show(); });
        c.addEventListener("blur", () => { calTip.hidden = true; });
      }
      c.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; c.classList.add("drop"); } });
      c.addEventListener("dragleave", () => c.classList.remove("drop"));
      c.addEventListener("drop", (e) => {
        e.preventDefault(); c.classList.remove("drop");
        const n = data?.notes.find((x) => x.id === e.dataTransfer?.getData(DRAG_TYPE));
        if (n) moveToDay(n, key);
      });
      return c;
    };
    const lead = (first.getDay() + 6) % 7, len = new Date(y!, mo!, 0).getDate();
    const firstKey = UI.month + "-01";
    const cells: HTMLElement[] = [];
    for (let i = lead; i > 0; i--) cells.push(cell(addDaysKey(firstKey, -i), true));
    for (let d = 1; d <= len; d++) cells.push(cell(`${UI.month}-${String(d).padStart(2, "0")}`, false));
    const lastKey = `${UI.month}-${String(len).padStart(2, "0")}`;
    for (let i = 1; (lead + len + i - 1) % 7 !== 0; i++) cells.push(cell(addDaysKey(lastKey, i), true));
    const grid = el("div", { cls: "tasks-calendar-grid", attrs: { role: "group", "aria-label": "Дни месяца: стрелки — день, PageUp и PageDown — месяц, двойной щелчок — новое дело на этот день" } }, ...cells);
    grid.addEventListener("keydown", (e) => {
      const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
      if (step) { e.preventDefault(); pickDay(addDaysKey(UI.day, step), true); return; }
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        const d = new Date(UI.day + "T12:00"), want = d.getDate();
        d.setDate(1); d.setMonth(d.getMonth() + (e.key === "PageUp" ? -1 : 1));
        d.setDate(Math.min(want, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
        pickDay(localDay(d), true);
      }
    });
    // on a phone the month turns with a swipe
    grid.addEventListener("pointerdown", (e) => { calSwipe = e.pointerType === "mouse" ? null : e.clientX; });
    grid.addEventListener("pointerup", (e) => { if (calSwipe !== null && Math.abs(e.clientX - calSwipe) > 50) shiftMonth(e.clientX < calSwipe ? 1 : -1); calSwipe = null; });
    const LEGEND: [string, string][] = [["holiday", "Праздник"], ["off", "Перенос"], ["short", "Сокращённый"], ["dot", "Есть дела"], ["late", "Не сделано"], ["star", "Дата из памяти"], ["heavy", "Перегруз"]];
    const legend = LEGEND.filter(([k]) => seen.has(k));
    const wh = automation?.weekHours ?? 40;
    const ms = prodStats(UI.month), ys = prodStats(UI.month.slice(0, 4));
    let footer: HTMLElement;
    if (ms && ys) {
      const isNow = UI.month === todayKey.slice(0, 7);
      let left = 0;
      if (isNow) for (let d = Number(todayKey.slice(8)); d <= len; d++) { const k = prodDay(`${UI.month}-${String(d).padStart(2, "0")}`)?.kind; if (k === "work" || k === "short") left++; }
      const from = isNow ? todayKey : UI.month < todayKey.slice(0, 7) ? null : addDaysKey(firstKey, -1);
      const hol = from ? nextHoliday(from, 120) : undefined;
      const rest = from ? nextLongRest(from, 120) : undefined;
      const fmt = (k: string) => new Date(k + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
      const eve = hol ? prodDay(addDaysKey(hol.key, -1)) : undefined;
      footer = el("div", { cls: "tasks-prod small" },
        el("span", { title: (isNow ? `До конца месяца рабочих дней: ${left}. ` : "") + `Рабочих дней ${ms.workDays}, выходных и праздников ${ms.offDays}` + (ms.shortDays ? `, сокращённых ${ms.shortDays}` : "") + `. Норма: ${fmtH(ms.hours[40])} при 40 ч, ${fmtH(ms.hours[36])} при 36 ч, ${fmtH(ms.hours[24])} при 24 ч в неделю.`,
          textContent: `${ms.workDays} рабочих · ${ms.offDays} выходных · ${fmtH(ms.hours[wh])}` + (isNow ? ` · осталось ${left}` : "") }),
        el("span", { cls: "muted", title: `За ${UI.month.slice(0, 4)} год: ${ys.workDays} рабочих дней, ${ys.offDays} выходных и праздников, норма ${fmtH(ys.hours[40])} при 40 ч, ${fmtH(ys.hours[36])} при 36 ч, ${fmtH(ys.hours[24])} при 24 ч в неделю. Неделю можно выбрать в «Автоматика → День».`,
          textContent: `${UI.month.slice(0, 4)}: ${ys.workDays} рабочих дней · ${fmtH(ys.hours[wh])}` + (wh === 40 ? "" : ` (${wh} ч в неделю)`) }),
        hol ? el("span", { cls: "tasks-prod-next" }, "Ближайший праздник: ", el("b", { textContent: fmt(hol.key) }), `, ${hol.note}, через ${hol.days} ${dayWord(hol.days)}` + (eve?.kind === "short" ? ` · ${fmt(addDaysKey(hol.key, -1))} короче на час` : "")) : null,
        rest && (!hol || rest.from !== hol.key) ? el("span", { cls: "muted", textContent: `Длинные выходные: ${fmt(rest.from)} – ${fmt(rest.to)}, ${rest.length} ${dayWord(rest.length)} подряд` }) : null);
    } else footer = el("p", { cls: "tasks-prod muted small", textContent: "Производственный календарь есть на 2026 и 2027 годы." });
    calHost.replaceChildren(head,
      el("div", { cls: "tasks-calendar-weekdays", attrs: { "aria-hidden": "true" } }, ...["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((x) => el("span", { textContent: x }))),
      grid,
      ...(legend.length ? [el("div", { cls: "tasks-calendar-legend muted small", attrs: { "aria-hidden": "true" } }, ...legend.map(([k, t]) => el("span", { cls: "lg " + k, textContent: t })))] : []),
      footer, calTip);
    calTip.hidden = true;
  }
  async function renderDay() {
    const [plan, blocks, ins] = await Promise.all([UI.day === localDay(new Date()) ? api.taskPlan() : Promise.resolve(null), api.timeBlocks(UI.day), monthInsights(UI.day.slice(0, 7))]);
    const dayName = new Date(UI.day + "T12:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    const sel = prodDay(UI.day);
    const dayItems = ins.ok ? ins.value.items.filter((x) => localDay(x.at) === UI.day).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : [];
    const open = data?.notes.filter((n) => n.kind === "todo" && !n.done && (!n.dueAt || localDay(n.dueAt) !== UI.day)) ?? [];
    const pick = el("select", { cls: "mem-select", attrs: { "aria-label": "Перенести дело на этот день" } }, el("option", { value: "", textContent: "＋ Перенести сюда дело…" }), ...open.map((n) => el("option", { value: n.id, textContent: n.text.slice(0, 80) })));
    pick.addEventListener("change", () => { const n = open.find((x) => x.id === pick.value); if (n) moveToDay(n, UI.day); });
    const rel = UI.day === localDay(new Date()) ? "Сегодня" : UI.day === localDay(new Date(Date.now() + 86_400_000)) ? "Завтра" : null;
    const parts: (Node | null)[] = [cardHead(dayHost, "day", rel ?? dayName[0]!.toUpperCase() + dayName.slice(1), rel === "Завтра" ? el("small", { cls: "muted", textContent: dayName }) : null),
      sel ? el("p", { cls: "tasks-prod-day " + sel.kind, textContent: DAY_KIND[sel.kind] + (sel.note ? ". " + sel.note : "") }) : null];
    parts.push(dayItems.length
      ? el("ul", { cls: "tasks-plan-list" }, ...dayItems.map((x) => el("li", { cls: x.done ? "done" : "" }, el("span", { cls: "tasks-plan-time", textContent: isDateOnly(x.at) ? "весь день" : hm(x.at) }), el("span", { cls: "grow", textContent: (x.kind === "reminder" ? "◷ " : "") + x.text }))))
      : el("p", { cls: "muted small", textContent: "В этот день ничего не запланировано." }));
    if (open.length) parts.push(pick);
    parts.push(arrangeBox());
    if (plan?.ok && plan.value.suggested.length) {
      parts.push(el("h3", { textContent: "Что сделать сначала" }),
        el("ol", { cls: "tasks-plan-list numbered" }, ...plan.value.suggested.slice(0, 3).map((x) => el("li", {}, el("span", { cls: "grow", textContent: x.text }), el("span", { cls: "br-tag", textContent: x.reason })))));
    }
    if (blocks.ok && blocks.value.blocks.length) {
      const v = blocks.value;
      parts.push(el("h3", { title: "Длительность берётся из поля «Минут» у дела, по умолчанию 30 минут, с 09:00 до 18:00." }, "По часам", el("small", { cls: "muted", textContent: ` в плане ${v.plannedMinutes} мин, свободно ${v.remainingMinutes}` })),
        el("ol", { cls: "tasks-plan-list" }, ...v.blocks.slice(0, 5).map((b) => el("li", {}, el("span", { cls: "tasks-plan-time", textContent: hm(b.start) }), el("span", { cls: "grow", textContent: b.text }), el("span", { cls: "muted small", textContent: b.minutes + " мин" }))),
          v.blocks.length > 5 ? el("li", { cls: "muted small", textContent: `и ещё ${v.blocks.length - 5}, до ${hm(v.blocks[v.blocks.length - 1]!.start)}` }) : null));
    }
    dayHost.replaceChildren(...parts.filter((x): x is Node => !!x));
  }
  /** «Разложить день»: the assistant's proposal for the selected day, with a tick for each to-do and one button to apply. */
  function arrangeBox(): HTMLElement {
    const past = UI.day < localDay(new Date());
    const st = arrange && arrange.day === UI.day ? arrange : null;
    const run = async () => {
      arrange = { day: UI.day, plan: null, picked: new Set() };
      void renderDay();
      const r = await api.arrangeDay(UI.day);
      if (!arrange || arrange.day !== UI.day) return;
      arrange = r.ok ? { day: UI.day, plan: r.value, picked: new Set(r.value.placed.map((p) => p.id)) } : { day: UI.day, plan: null, error: r.error.message, picked: new Set() };
      void renderDay();
    };
    if (!st) return el("div", { cls: "tasks-arrange-start" }, btn("Разложить день", () => void run(), { small: true, icon: "wand", disabled: past, title: past ? "Этот день уже прошёл" : "Расставить дела без времени по свободным окнам этого дня" }));
    const close = () => { arrange = null; void renderDay(); };
    if (!st.plan) return el("div", { cls: "tasks-arrange" + (st.error ? " error" : "") }, el("p", { cls: "small grow", textContent: st.error ?? "Подбираю свободные окна…" }), iconButton("x", "Закрыть", close, "icon-btn sm"));
    const p = st.plan;
    if (!p.placed.length) return el("div", { cls: "tasks-arrange" }, el("p", { cls: "small grow", textContent: p.left ? "Свободных окон не хватает: день уже занят." : "Нечего раскладывать: у всех дел этого дня уже есть время." }), iconButton("x", "Закрыть", close, "icon-btn sm"));
    const apply = btn("Применить", async () => {
      const ids = [...st.picked];
      if (!ids.length) { showToast("Отметьте хотя бы одно дело."); return; }
      apply.disabled = true;
      const ok = await act(() => api.arrangeDay(p.day, true, ids), `Разложено дел: ${ids.length}. Отменить можно в «Автоматика → Журнал»`);
      if (ok) arrange = null;
      void renderDay();
    }, { small: true, primary: true });
    return el("div", { cls: "tasks-arrange" },
      el("p", { cls: "small muted", textContent: `Свободные окна с ${p.window.from} до ${p.window.to}` + (p.left ? `; не поместилось: ${p.left}` : "") + "." }),
      el("ol", { cls: "tasks-arrange-list" }, ...p.placed.map((x) => {
        const box = el("input", { type: "checkbox", checked: st.picked.has(x.id), attrs: { "aria-label": "Поставить: " + x.text } });
        box.addEventListener("change", () => { if (box.checked) st.picked.add(x.id); else st.picked.delete(x.id); });
        return el("li", {}, el("label", {}, box, el("span", { cls: "tasks-plan-time", textContent: hm(x.start) }), el("span", { cls: "grow" }, el("span", { textContent: x.text }), el("small", { cls: "muted", textContent: `${x.minutes} мин · ${x.reason}` }))));
      })),
      el("div", { cls: "row" }, apply, btn("Отмена", close, { small: true })));
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
      const status = el("div", { cls: "tasks-goal-status", attrs: { role: "radiogroup", "aria-label": "Состояние цели " + m.title } }, ...([["active", "В работе"], ["paused", "Пауза"], ["complete", "Готово"]] as const).map(([value, label]) => {
        const b = el("button", { type: "button", cls: value, textContent: label, attrs: { role: "radio", "aria-checked": String(m.status === value) } });
        b.addEventListener("click", () => { if (m.status !== value) void act(() => api.changeMissionStatus(m.id, value), value === "complete" ? "Цель достигнута!" : undefined); });
        return b;
      }));
      const ring = el("div", { cls: "tasks-ring sm" + (m.total && m.percent === 100 ? " full" : ""), attrs: { role: "img", "aria-label": `Прогресс цели: ${m.percent}%` } }, el("span", { cls: "tasks-ring-num", textContent: m.total ? m.percent + "%" : "0" }));
      ring.style.setProperty("--p", String(m.percent));
      // the open steps first, then a few done ones; each can be ticked right here
      const steps = [...m.stages.filter((x) => !x.done), ...m.stages.filter((x) => x.done)].slice(0, 5);
      const stepList = steps.length ? el("ul", { cls: "tasks-goal-steps" }, ...steps.map((x) => {
        const box = el("input", { type: "checkbox", checked: x.done, attrs: { "aria-label": (x.done ? "Вернуть шаг: " : "Шаг сделан: ") + x.text } });
        box.addEventListener("change", () => { goalsSig = ""; void act(() => api.setTodoDone(x.id, box.checked), box.checked ? "Шаг сделан" : undefined); });
        return el("li", { cls: x.done ? "done" : "" }, el("label", {}, box, el("span", { textContent: x.text })));
      }), m.stages.length > steps.length ? el("li", { cls: "muted small more", textContent: `и ещё ${m.stages.length - steps.length}` }) : null) : null;
      const nudge = automation?.goalNudge && m.status === "active" && m.next && (m.idleDays ?? 0) >= automation.goalNudge
        ? el("div", { cls: "tasks-goal-nudge" }, el("span", { cls: "grow small", textContent: `Стоит ${m.idleDays} дн. Следующий шаг: ${m.next.text}` }),
            btn("На сегодня", () => { const d = new Date(); d.setHours(23, 59, 0, 0); goalsSig = ""; void act(() => api.updateTask(m.next!.id, { dueAt: d.toISOString() }), "Шаг в делах на сегодня"); }, { small: true }))
        : null;
      return el("article", { cls: "tasks-goal " + m.status + (nudge ? " idle" : "") },
        el("div", { cls: "tasks-goal-head" }, ring,
          el("div", { cls: "grow" }, el("strong", { textContent: m.title }), el("small", { cls: "muted", textContent: m.total ? `шагов ${m.done} из ${m.total}` + (m.blocked ? ` · ждут: ${m.blocked}` : "") : "шагов пока нет" }))),
        status,
        nudge,
        stepList,
        m.status === "active" ? el("div", { cls: "tasks-goal-add" }, addStage,
          iconButton("spark", "Разбить цель на шаги", () => void startSplit("goal:" + m.id, [m.title, m.description, m.stages.length ? "Уже есть шаги: " + m.stages.map((x) => x.text).join("; ") : ""].filter(Boolean).join(". "), renderGoals), "icon-btn sm")) : null,
        stepsPanel("goal:" + m.id, renderGoals, (steps) => act(async () => {
          for (const x of steps) { const r = await api.addMissionStage(m.id, x); if (!r.ok) return r; }
          goalsSig = "";
          return { ok: true };
        }, `Добавлено шагов: ${steps.length}`)));
    });
    const examples = ["Выучить английский до A2", "Ремонт на кухне", "Пробежать 10 км"];
    const empty = el("div", { cls: "tasks-goal-empty" },
      el("span", { cls: "tasks-goal-empty-ic", attrs: { "aria-hidden": "true" } }, icon("target", 28)),
      el("p", { cls: "small", textContent: "Цель — большое дело из нескольких шагов. Отмечайте шаги, а кольцо покажет, сколько пройдено." }),
      el("div", { cls: "chips" }, ...examples.map((x) => { const c = el("button", { type: "button", cls: "chip", textContent: x }); c.addEventListener("click", () => { title.value = x; title.focus(); }); return c; })));
    const active = missions.filter((m) => m.status === "active").length;
    goalsHost.replaceChildren(cardHead(goalsHost, "goals", "Цели", missions.length ? el("small", { cls: "muted", textContent: `в работе: ${active}` }) : null),
      ...(cards.length ? cards : [empty]), form);
  }

  // ---------- automation settings: scenarios in tabs ----------
  const setAuto = async (patch: Partial<Automation>) => {
    const r = await api.setAutomation(patch);
    if (r.ok) { automation = r.value; showToast("Сохранено", { ms: 1500 }); } else showToast(r.error.message, { ms: 8000 });
    renderAuto();
    void load();
  };
  const AUTO_TABS = [["morning", "Утро", "sun"], ["day", "День", "clock"], ["evening", "Вечер", "moon"], ["week", "Неделя", "calendar"], ["rules", "Правила", "spark"], ["log", "Журнал", "list"]] as const;
  type AutoTab = typeof AUTO_TABS[number][0];
  let autoTab = (store.get(AUTO_TAB) ?? "morning") as AutoTab;
  if (!AUTO_TABS.some(([k]) => k === autoTab)) autoTab = "morning";
  let autoLog: AutoLogEntry[] | null = null;
  const evidenceHost=el("div",{cls:"tasks-automation-evidence"});
  const loadEvidence=async()=>{
    const result=await api.automationEvidence();
    if(!result.ok){evidenceHost.replaceChildren(el("p",{cls:"muted small",textContent:"Метрики временно недоступны"}));return;}
    const v=result.value;
    evidenceHost.replaceChildren(
      el("h3",{textContent:"Brain · проверяемые результаты"}),
      el("p",{cls:"muted small",textContent:`Событий: ${v.totals.logged} · Действий отменено: ${v.totals.undone} · Автопереносов: ${v.totals.automaticMoves}`}),
      el("p",{cls:"muted small",textContent:`Разрешения: автоперенос ${v.permissions.rollOverdue?"включён":"отключён"}, напоминания ${v.permissions.reminders?"включены":"отключены"}, правил ${v.permissions.rules}`}),
      ...v.warnings.map(w=>el("p",{cls:"tasks-mission-next",textContent:w})),
      el("p",{cls:"muted small",textContent:"Только наблюдение по журналу и истории задач. Не является обучением весов модели."}));
  };

  const loadLog = async () => { const r = await api.autoLog(); autoLog = r.ok ? r.value : []; if (autoTab === "log") { renderAuto(); void loadEvidence(); } };
  const LOG_ICON: Record<AutoLogEntry["kind"], string> = { roll: "↷", remind: "⏰", brief: "☀", evening: "☾", week: "▦", quiet: "☁", arrange: "▤", move: "→", rule: "✦" };
  const WEEKDAY_NAMES = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
  const ruleText = (r: AutoRule) => {
    const when = r.match === "tag" ? `дело с #${r.value}` : r.match === "word" ? `в деле есть «${r.value}»` : "дело отмечено важным";
    const then = r.action === "important" ? "отметить важным" : r.action === "before" ? `напомнить за ${r.minutes === 1440 ? "сутки" : r.minutes! >= 60 ? r.minutes! / 60 + " ч" : r.minutes + " мин"} до срока` : `напомнить в ${WEEKDAY_NAMES[r.weekday!]} в ${r.time}`;
    return `Если ${when} → ${then}`;
  };
  function renderAuto() {
    autoHost.hidden = !automation;
    if (!automation) return;
    const a = automation;
    const toggle = (label: string, note: string, on: boolean, patch: (v: boolean) => Partial<Automation>, extra?: HTMLElement) => {
      const c = el("input", { type: "checkbox", checked: on, cls: "tasks-switch", attrs: { role: "switch" } });
      c.addEventListener("change", () => void setAuto(patch(c.checked)));
      return el("label", { cls: "tasks-auto-row" }, c, el("span", { cls: "grow" }, el("span", { textContent: label }), el("small", { cls: "muted", textContent: note })), extra ?? null);
    };
    const timeField = (value: string, label: string, disabled: boolean, key: "briefTime" | "eveningTime" | "quietFrom" | "quietTo") => {
      const t = el("input", { type: "time", value, cls: "mem-select tasks-time", disabled, attrs: { "aria-label": label } });
      t.addEventListener("click", (e) => e.stopPropagation());
      t.addEventListener("change", () => { if (t.value && t.value !== value) void setAuto({ [key]: t.value } as Partial<Automation>); });
      return t;
    };
    const select = <T extends string | number>(label: string, value: T, options: [T, string][], patch: (v: T) => Partial<Automation>) => {
      const s = el("select", { cls: "mem-select", attrs: { "aria-label": label } }, ...options.map(([v, t]) => el("option", { value: String(v), textContent: t })));
      s.value = String(value);
      s.addEventListener("change", () => { const o = options.find(([v]) => String(v) === s.value); if (o) void setAuto(patch(o[0])); });
      return s;
    };
    const selRow = (label: string, note: string, s: HTMLElement) => el("label", { cls: "tasks-auto-row" }, el("span", { cls: "grow" }, el("span", { textContent: label }), el("small", { cls: "muted", textContent: note })), s);
    const on = { morning: [a.brief, a.rollOverdue, a.holidayWarn], day: [a.dueReminder !== "off", a.quiet, a.dayHours > 0, a.stuckAfter > 0, a.chatPromises], evening: [a.evening], week: [a.weekly, a.goalNudge > 0, a.streaks], rules: [a.rules.length > 0], log: [] as boolean[] };
    const tabs = el("div", { cls: "tasks-auto-tabs", attrs: { role: "tablist", "aria-label": "Сценарии автоматики" } }, ...AUTO_TABS.map(([k, label, ic]) => {
      const n = on[k].filter(Boolean).length;
      const b = el("button", { type: "button", cls: "tasks-auto-tab" + (n ? " on" : ""), attrs: { role: "tab", "aria-selected": String(autoTab === k) } }, icon(ic, 15), el("span", { textContent: label }),
        k === "log" ? null : el("i", { cls: "tasks-auto-dot", title: n ? `включено: ${n} из ${on[k].length}` : "выключено" }));
      b.addEventListener("click", () => { autoTab = k; store.set(AUTO_TAB, k); if (k === "log") void loadLog(); renderAuto(); });
      return b;
    }));
    let body: (HTMLElement | null)[] = [];
    if (autoTab === "morning") body = [
      toggle("Утренняя сводка", "дела, напоминания, застрявшее и цели; с ключом Cloud.ru пишет ассистент", a.brief, (v) => ({ brief: v }), timeField(a.briefTime, "Время утренней сводки", !a.brief, "briefTime")),
      toggle("Переносить просроченное на сегодня", "после полуночи, с пометкой «перенесено»", a.rollOverdue, (v) => ({ rollOverdue: v })),
      toggle("Предупреждать о праздниках", "накануне праздника или сокращённого дня, с кнопкой сдвинуть дела", a.holidayWarn, (v) => ({ holidayWarn: v })),
      toggle("Праздники в «по будням»", "по производственному календарю: праздники пропускаются, рабочие субботы считаются", a.workdays, (v) => ({ workdays: v })),
      el("div", { cls: "row" }, btn("Сводка сейчас", () => void act(() => api.runBrief(), "Сводка готова"), { small: true, icon: "sun" }))];
    else if (autoTab === "day") body = [
      selRow("Напоминать о сроке дела", `для дел со временем; «утром» — в ${a.briefTime}`, select("Напоминать о сроке дела", a.dueReminder, [["off", "Не напоминать"], ["15", "За 15 минут"], ["60", "За час"], ["morning", "Утром в день срока"]], (v) => ({ dueReminder: v }))),
      toggle("Тихие часы", "ночью без звука; автоматические напоминания ждут утра, свои приходят вовремя", a.quiet, (v) => ({ quiet: v }),
        el("span", { cls: "tasks-time-range" }, timeField(a.quietFrom, "Тихие часы с", !a.quiet, "quietFrom"), el("span", { textContent: "–" }), timeField(a.quietTo, "Тихие часы до", !a.quiet, "quietTo"))),
      selRow("Свободных часов в рабочий день", "для загрузки дня и «Разложить день»; в выходной — половина", select("Свободных часов в рабочий день", a.dayHours, [[0, "Не считать"], [4, "4 ч"], [6, "6 ч"], [7, "7 ч"], [8, "8 ч"], [9, "9 ч"], [10, "10 ч"]], (v) => ({ dayHours: v }))),
      selRow("Рабочая неделя", "для нормы часов в календаре по производственному календарю", select("Рабочая неделя", a.weekHours ?? 40, [[40, "40 ч"], [36, "36 ч"], [24, "24 ч"]], (v) => ({ weekHours: v }))),
      selRow("Застрявшие дела", "после скольких переносов спросить, что с делом сделать", select("Застрявшие дела", a.stuckAfter, [[0, "Не спрашивать"], [2, "После 2 раз"], [3, "После 3 раз"], [5, "После 5 раз"]], (v) => ({ stuckAfter: v }))),
      toggle("Обещания из чата", "«завтра надо позвонить» в чате — карточка «Добавить в дела?»", a.chatPromises, (v) => ({ chatPromises: v }))];
    else if (autoTab === "evening") body = [
      toggle("Итог дня", "что сделано, что осталось, что завтра; остаток — на завтра одной кнопкой", a.evening, (v) => ({ evening: v }), timeField(a.eveningTime, "Время итога дня", !a.evening, "eveningTime")),
      el("div", { cls: "row" }, btn("Итог сейчас", () => void act(() => api.runEvening(), "Итог дня готов"), { small: true, icon: "moon" }), btn("Открыть «Итог дня»", () => { evening = true; render(); heroHost.scrollIntoView({ behavior: "smooth" }); }, { small: true }))];
    else if (autoTab === "week") body = [
      toggle("Обзор недели", `в воскресенье в ${a.eveningTime}: сделано, застряло, цели, что впереди`, a.weekly, (v) => ({ weekly: v })),
      selRow("Подталкивать к целям", "если цель не двигалась столько дней, сводка предложит следующий шаг", select("Подталкивать к целям", a.goalNudge, [[0, "Не подталкивать"], [3, "Через 3 дня"], [7, "Через неделю"], [14, "Через 2 недели"]], (v) => ({ goalNudge: v }))),
      toggle("Серии у повторяющихся дел", "🔥 сколько раз подряд сделано вовремя; пропуск обнуляет", a.streaks, (v) => ({ streaks: v })),
      el("div", { cls: "row" }, btn("Обзор сейчас", () => void act(() => api.runWeek(), "Обзор недели готов"), { small: true, icon: "calendar" }))];
    else if (autoTab === "rules") body = [rulesEditor(a)];
    else {
      if (!autoLog) void loadLog();
      const list = autoLog ?? [];
      body = [evidenceHost, list.length
        ? el("ul", { cls: "tasks-auto-log" }, ...list.slice(0, 20).map((e) => el("li", { cls: e.undone ? "undone" : "" },
            el("span", { cls: "tasks-log-ic", attrs: { "aria-hidden": "true" }, textContent: LOG_ICON[e.kind] ?? "•" }),
            el("span", { cls: "grow" }, el("span", { textContent: e.text }), el("small", { cls: "muted", textContent: " · " + whenLabel(e.at, false) + (e.undone ? " · отменено" : "") })),
            e.undo && !e.undone ? iconButton("undo", "Отменить: " + e.text, () => void act(() => api.undoAuto(e.id), "Отменено").then(() => loadLog()), "icon-btn sm") : null)))
        : el("p", { cls: "muted small", textContent: autoLog ? "Автоматика пока ничего не делала." : "Загрузка…" })];
    }
    autoHost.replaceChildren(cardHead(autoHost, "auto", "Автоматика"), tabs, el("div", { cls: "tasks-auto-body", attrs: { role: "tabpanel" } }, ...body.filter((x): x is HTMLElement => !!x)));
  }
  /** «Если — то»: the list of rules and a one-line form for a new one. */
  function rulesEditor(a: Automation): HTMLElement {
    const save = (rules: AutoRule[]) => setAuto({ rules });
    const list = a.rules.length ? el("ul", { cls: "tasks-rules" }, ...a.rules.map((r) => el("li", {}, el("span", { cls: "grow", textContent: ruleText(r) }),
      iconButton("trash", "Удалить правило", () => void save(a.rules.filter((x) => x.id !== r.id)), "icon-btn sm"))))
      : el("p", { cls: "muted small", textContent: "Правил пока нет. Например: «дело с #покупки → напомнить в субботу в 10:00»." });
    const match = el("select", { cls: "mem-select", attrs: { "aria-label": "Если" } }, el("option", { value: "tag", textContent: "Тег #" }), el("option", { value: "word", textContent: "Слово в деле" }), el("option", { value: "important", textContent: "Дело важное ⚑" }));
    const value = el("input", { type: "text", maxLength: 40, cls: "mem-input", placeholder: "покупки", attrs: { "aria-label": "Тег или слово" } });
    const action = el("select", { cls: "mem-select", attrs: { "aria-label": "Тогда" } }, el("option", { value: "weekday", textContent: "Напомнить в день недели" }), el("option", { value: "before", textContent: "Напомнить до срока" }), el("option", { value: "important", textContent: "Отметить важным" }));
    const minutes = el("select", { cls: "mem-select", attrs: { "aria-label": "За сколько" } }, ...([[15, "за 15 мин"], [30, "за 30 мин"], [60, "за час"], [180, "за 3 часа"], [1440, "за сутки"]] as const).map(([v, t]) => el("option", { value: String(v), textContent: t })));
    minutes.value = "60";
    const wd = el("select", { cls: "mem-select", attrs: { "aria-label": "День недели" } }, ...[1, 2, 3, 4, 5, 6, 0].map((d) => el("option", { value: String(d), textContent: ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][d]! })));
    wd.value = "6";
    const time = el("input", { type: "time", value: "10:00", cls: "mem-select tasks-time", attrs: { "aria-label": "Время" } });
    const sync = () => {
      value.hidden = match.value === "important";
      value.placeholder = match.value === "tag" ? "покупки" : "налог";
      const imp = action.querySelector<HTMLOptionElement>('option[value="important"]')!;
      imp.disabled = match.value === "important";
      if (imp.disabled && action.value === "important") action.value = "before";
      minutes.hidden = action.value !== "before";
      wd.hidden = time.hidden = action.value !== "weekday";
    };
    match.addEventListener("change", sync); action.addEventListener("change", sync); sync();
    const add = btn("Добавить правило", () => {
      if (match.value !== "important" && !value.value.trim()) { value.focus(); return; }
      const r: AutoRule = { id: "r" + Date.now().toString(36), match: match.value as AutoRule["match"], value: value.value.trim(), action: action.value as AutoRule["action"],
        ...(action.value === "before" ? { minutes: Number(minutes.value) } : {}), ...(action.value === "weekday" ? { weekday: Number(wd.value), time: time.value || "10:00" } : {}) };
      void save([...a.rules, r]);
    }, { small: true, primary: true, icon: "plus" });
    return el("div", { cls: "tasks-rules-box" }, list,
      el("div", { cls: "tasks-rule-form" }, el("span", { cls: "tasks-rule-word", textContent: "Если" }), match, value, el("span", { cls: "tasks-rule-word", textContent: "то" }), action, minutes, wd, time, add));
  }
  // ---------- dates from memory ----------
  let datesSig = "";
  function renderDates() {
    const skip = new Set((store.get(SKIP_DATES) ?? "").split(",").filter(Boolean));
    const list = data ? memoryDates(app.get().memory, data.reminders).filter((d) => !skip.has(d.id)) : [];
    datesHost.hidden = !list.length;
    datesHost.replaceChildren(...(list.length ? [cardHead(datesHost, "dates", "Даты из памяти", el("small", { cls: "muted", textContent: "напоминать каждый год?" })),
      el("ul", { cls: "tasks-dates" }, ...list.slice(0, 5).map((d) => {
        const when = new Date(d.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
        return el("li", {}, el("span", { cls: "grow" }, el("span", { textContent: d.text }), el("small", { cls: "muted", textContent: " · в 9:00" })),
          btn("Напоминать", () => void act(() => api.addReminder(d.text, d.at, "yearly"), `Напомню ${when} и дальше каждый год`), { small: true, primary: true }),
          iconButton("x", "Не нужно", () => { skip.add(d.id); store.set(SKIP_DATES, [...skip].slice(-200).join(",")); renderDates(); }, "icon-btn sm"));
      }))] : []));
  }

  // ---------- toolbar and keys ----------
  const search = el("input", { type: "search", placeholder: "Поиск", value: UI.query, cls: "mem-search", attrs: { "aria-label": "Поиск по делам и заметкам" } });
  const toolbar = el("div", { cls: "mem-toolbar" }, search, chipsHost);
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
    el("header", { cls: "pg-head tasks-head" }, el("div", { cls: "pg-head-text" }, el("h1", { textContent: "Дела" })),
      el("div", { cls: "row" }, btn("Итог дня", () => { evening = !evening; render(); }, { small: true, icon: "moon", title: "Что сделано сегодня и что перенести на завтра" }), perm)),
    attHost,
    heroHost,
    el("div", { cls: "tasks-layout" },
      el("aside", { cls: "tasks-ach", attrs: { "aria-label": "Дела и достижения" } }, ach.el),
      el("div", { cls: "tasks-main" },
        el("section", { cls: "pg-card tasks-quick" }, form),
        eveHost,
        toolbar,
        listHost),
      el("aside", { cls: "tasks-side", attrs: { "aria-label": "Календарь и планы" } }, calHost, dayHost, forecastHost, goalsHost, datesHost, autoHost)));
  autoHost.hidden = true; datesHost.hidden = true;
  render();
  renderAttention(app.get());
  void load();
  return root;
}
