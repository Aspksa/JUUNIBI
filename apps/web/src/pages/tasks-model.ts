/** Pure model behind the "Дела" page (tested in test/tasks-model.test.ts). */
import type { Area, DayLoad, DayOff, Note, ProjectMeta, Reminder, Repeat, TaskStatus } from "../api";
import { prodDay } from "@juunibi/core";

export type TaskFilter = "all" | "todo" | "note" | "reminder";
/** The «Всё / Работа / Личное» switch over the list. */
export type AreaFilter = "all" | Area;

/** A to-do's sphere: its own, else its project's, else «work» for a project named работа/work (as the server counts). */
export function areaOf(n: Pick<Note, "area" | "project">, projects: ProjectMeta[] = []): Area {
  if (n.area) return n.area;
  if (!n.project) return "personal";
  const p = projects.find((x) => x.name.toLowerCase() === n.project!.toLowerCase());
  if (p?.area) return p.area;
  return /^(работа|work|рабочее)$/i.test(n.project) ? "work" : "personal";
}
/** Inside the working hours of a working day: the list shows work first; outside them, personal first. */
export function preferredArea(now: Date, o: { workFrom: string; workTo: string; workday: boolean }): Area {
  const m = now.getHours() * 60 + now.getMinutes();
  const at = (hm: string) => { const [h, mm] = hm.split(":").map(Number); return h! * 60 + mm!; };
  return o.workday && m >= at(o.workFrom) && m < at(o.workTo) ? "work" : "personal";
}
export const STATUS_LABEL: Record<TaskStatus | "todo" | "done", string> = { todo: "Надо сделать", doing: "В работе", waiting: "Жду ответа", done: "Готово" };
/** The board: open to-dos by status and the ones finished in the last week (newest first, at most 20). */
export function boardColumns(notes: Note[], now = new Date()): Record<"todo" | TaskStatus | "done", Note[]> {
  const todos = notes.filter((n) => n.kind === "todo" && !n.auto);
  const due = (n: Note) => (n.dueAt ? Date.parse(n.dueAt) : Infinity);
  const order = (a: Note, b: Note) => Number(b.priority === "high") - Number(a.priority === "high") || due(a) - due(b) || a.createdAt.localeCompare(b.createdAt);
  const open = todos.filter((n) => !n.done);
  const weekAgo = now.getTime() - 7 * 86_400_000;
  return {
    todo: open.filter((n) => !n.status).sort(order),
    doing: open.filter((n) => n.status === "doing").sort(order),
    waiting: open.filter((n) => n.status === "waiting").sort(order),
    done: todos.filter((n) => n.done && Date.parse(n.completedAt ?? n.createdAt) >= weekAgo).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")).slice(0, 20),
  };
}
/** This week's work to-dos (Monday to Sunday): minutes planned and minutes done (30 for a to-do without an estimate). */
export function workWeek(notes: Note[], projects: ProjectMeta[], now = new Date()): { planned: number; done: number; count: number } {
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const from = mon.getTime(), to = from + 7 * 86_400_000;
  const work = notes.filter((n) => n.kind === "todo" && n.dueAt && Date.parse(n.dueAt) >= from && Date.parse(n.dueAt) < to && areaOf(n, projects) === "work");
  const mins = (xs: Note[]) => xs.reduce((s, n) => s + (n.estimateMinutes ?? 30), 0);
  return { planned: mins(work), done: mins(work.filter((n) => n.done)), count: work.length };
}
/** The vacation or sick leave on a day, if any. */
export const awayOn = (daysOff: DayOff[] | undefined, key: string): DayOff | undefined => daysOff?.find((d) => d.from <= key && key <= d.to);
/** «с 10:00 до 11:00» of a meeting, or just its start. */
export function meetingSpan(n: Note): string {
  if (!n.dueAt) return "";
  const t = (ms: number) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const start = Date.parse(n.dueAt);
  return n.estimateMinutes ? `${t(start)}–${t(start + n.estimateMinutes * 60_000)}` : t(start);
}
export const REPEAT_LABEL: Record<Repeat, string> = { daily: "каждый день", weekdays: "по будням", weekly: "каждую неделю", monthly: "каждый месяц", every3days: "каждые 3 дня", yearly: "каждый год" };
export const REPEAT_OPTIONS: [Repeat | "none", string][] = [["none", "Один раз"], ["daily", "Каждый день"], ["weekdays", "По будням"], ["weekly", "Каждую неделю"], ["monthly", "Каждый месяц"], ["every3days", "Каждые 3 дня"], ["yearly", "Каждый год"]];

/** The value of a datetime-local input for tomorrow 09:00, in local time. */
export function defaultReminderTime(now = new Date()): string {
  return toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0).toISOString());
}
/** An ISO time as the value of a datetime-local input (local time, minutes). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The local calendar day of a moment, YYYY-MM-DD (an ISO string's first 10 characters are the UTC day). */
export const localDay = (iso: string | number | Date): string => toLocalInput(new Date(iso).toISOString()).slice(0, 10);
/** A to-do due at 23:59 has a date and no time of its own. */
export const isDateOnly = (iso: string): boolean => { const d = new Date(iso); return d.getHours() === 23 && d.getMinutes() === 59; };

/** One line of the timeline: a to-do with a due date or a planned reminder. */
export type TimedItem = { type: "todo"; note: Note; at: number } | { type: "reminder"; reminder: Reminder; at: number };
export interface TaskView {
  /** Reminders that went off and wait for "Готово" or "Отложить". */
  due: Reminder[];
  overdue: TimedItem[];
  today: TimedItem[];
  tomorrow: TimedItem[];
  later: TimedItem[];
  /** Open to-dos without a date: important first, then oldest first. */
  someday: Note[];
  notes: Note[];
  /** Today's morning brief written by the automation, shown apart from the notes. */
  brief?: Note;
  /** Today's evening summary and the latest weekly review (kept for Sunday and Monday). */
  evening?: Note;
  week?: Note;
  /** Subtasks shown under their to-do (only while not searching). */
  children: Record<string, Note[]>;
  finished: { todos: Note[]; reminders: Reminder[] };
  counts: Record<TaskFilter, number>;
  summary: { today: number; overdue: number; doneToday: number };
}

/**
 * What the page shows, in order: reminders that went off, then one timeline of to-dos and reminders
 * (overdue, today, tomorrow, later), to-dos without a date, notes and the finished ones. Days are local days.
 */
export function buildTasks(org: { notes: Note[]; reminders: Reminder[] }, filter: TaskFilter = "all", query = "", now = new Date(),
  o: { area?: AreaFilter; prefer?: Area; projects?: ProjectMeta[] } = {}): TaskView {
  if (o.area && o.area !== "all") {
    // «Работа» shows the work to-dos only; «Личное» the rest, with reminders and notes
    const want = o.area;
    org = { notes: org.notes.filter((n) => n.kind === "todo" ? areaOf(n, o.projects) === want : want === "personal"), reminders: want === "work" ? [] : org.reminders };
  }
  const q = query.trim().toLowerCase();
  const hit = (t: string) => !q || t.toLowerCase().includes(q);
  const show = (f: TaskFilter) => filter === "all" || filter === f;
  const todayKey = localDay(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowKey = localDay(tomorrow);
  const ids = new Set(org.notes.filter((n) => n.kind === "todo").map((n) => n.id));
  const nest = !q;
  const children: Record<string, Note[]> = {};
  if (nest) for (const n of org.notes) if (n.kind === "todo" && n.parentId && ids.has(n.parentId)) (children[n.parentId] ??= []).push(n);
  for (const list of Object.values(children)) list.sort((a, b) => Number(a.done) - Number(b.done) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const isChild = (n: Note) => nest && !!n.parentId && ids.has(n.parentId);
  /** 0 for the sphere that goes first now, 1 for the other one (all 0 when nothing is preferred). */
  const pref = (n: Note) => (o.prefer && areaOf(n, o.projects) !== o.prefer ? 1 : 0);

  const open = show("todo") ? org.notes.filter((n) => n.kind === "todo" && !n.done && !isChild(n) && hit(n.text)) : [];
  const planned = show("reminder") ? org.reminders.filter((r) => r.status === "scheduled" && hit(r.text)) : [];
  const timed: TimedItem[] = [
    ...open.filter((n) => n.dueAt).map((n) => ({ type: "todo" as const, note: n, at: Date.parse(n.dueAt!) })),
    ...planned.map((r) => ({ type: "reminder" as const, reminder: r, at: Date.parse(r.at) })),
  ].sort((a, b) => a.at - b.at || (a.type === "todo" && b.type === "todo" ? pref(a.note) - pref(b.note) : 0));
  const view: TaskView = {
    due: show("reminder") ? org.reminders.filter((r) => r.status === "due" && hit(r.text)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : [],
    overdue: [], today: [], tomorrow: [], later: [],
    someday: open.filter((n) => !n.dueAt).sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || pref(a) - pref(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    notes: show("note") ? org.notes.filter((n) => n.kind === "note" && !n.auto && hit(n.text)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) : [],
    children,
    finished: {
      todos: show("todo") ? org.notes.filter((n) => n.kind === "todo" && n.done && !isChild(n) && hit(n.text)).sort((a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt)).slice(0, 30) : [],
      reminders: show("reminder") ? org.reminders.filter((r) => r.status === "done" && hit(r.text)).sort((a, b) => Date.parse(b.firedAt ?? b.at) - Date.parse(a.firedAt ?? a.at)).slice(0, 20) : [],
    },
    counts: {
      all: org.notes.filter((n) => !(n.kind === "todo" && n.done) && !n.auto).length + org.reminders.filter((r) => r.status !== "done").length,
      todo: org.notes.filter((n) => n.kind === "todo" && !n.done).length,
      note: org.notes.filter((n) => n.kind === "note" && !n.auto).length,
      reminder: org.reminders.filter((r) => r.status !== "done").length,
    },
    summary: { today: 0, overdue: 0, doneToday: org.notes.filter((n) => n.kind === "todo" && n.done && n.completedAt && localDay(n.completedAt) === todayKey).length },
  };
  const brief = org.notes.find((n) => n.auto === "brief");
  if (brief && localDay(brief.createdAt) === todayKey) view.brief = brief;
  const evening = org.notes.find((n) => n.auto === "evening");
  if (evening && localDay(evening.createdAt) === todayKey) view.evening = evening;
  const week = org.notes.find((n) => n.auto === "week");
  if (week && now.getTime() - Date.parse(week.createdAt) < 36 * 3_600_000) view.week = week;
  for (const it of timed) {
    const key = localDay(it.at);
    // a to-do is overdue once its moment has passed; a planned reminder fires by itself, so it stays in its day
    if (it.type === "todo" && it.at < now.getTime()) view.overdue.push(it);
    else if (key <= todayKey) view.today.push(it);
    else if (key === tomorrowKey) view.tomorrow.push(it);
    else view.later.push(it);
  }
  const allOpen = org.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt);
  view.summary.overdue = allOpen.filter((n) => Date.parse(n.dueAt!) < now.getTime()).length;
  view.summary.today = allOpen.filter((n) => Date.parse(n.dueAt!) >= now.getTime() && localDay(n.dueAt!) === todayKey).length
    + org.reminders.filter((r) => r.status === "scheduled" && localDay(r.at) === todayKey).length;
  return view;
}

const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const DATE_WORDS = /(день рождени|дня рождени|днём рождени|днем рождени|(?:^|[^а-яё])др(?![а-яё])|годовщин|юбиле|именин|свадьб)/i;
/** A date from memory that could become a yearly reminder. */
export interface MemoryDate { id: string; text: string; month: number; day: number; at: string }
/**
 * Birthdays, anniversaries and other yearly dates found in memory («у мамы день рождения 12 марта», «годовщина 05.06»),
 * each with its next 09:00. Skips the ones already turned into a yearly reminder with the same text.
 */
export function memoryDates(memory: { id: string; text: string; status?: string }[], reminders: Reminder[], now = new Date()): MemoryDate[] {
  const have = new Set(reminders.filter((r) => r.repeat === "yearly").map((r) => r.text.trim().toLowerCase()));
  const out: MemoryDate[] = [];
  for (const m of memory) {
    if (m.status === "pending" || !DATE_WORDS.test(m.text)) continue;
    let day = 0, month = 0;
    const w = /(?:^|[^\d])(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.exec(m.text);
    if (w) { day = Number(w[1]); month = MONTHS.findIndex((x) => w[2]!.toLowerCase().startsWith(x)) + 1; }
    else {
      const d = /(?:^|[^\d.])(\d{1,2})\.(\d{1,2})(?:\.(?:\d{4}|\d{2}))?(?![\d.]*\d)/.exec(m.text);
      if (d) { day = Number(d[1]); month = Number(d[2]); }
    }
    if (!day || month < 1 || month > 12) continue;
    // 29 February comes back on 28 February in other years
    const at = (y: number) => { const last = new Date(y, month, 0).getDate(); return new Date(y, month - 1, Math.min(day, last), 9, 0); };
    if (day > new Date(2024, month, 0).getDate()) continue;
    let next = at(now.getFullYear());
    if (next.getTime() <= now.getTime()) next = at(now.getFullYear() + 1);
    const text = m.text.trim().slice(0, 200);
    if (have.has(text.toLowerCase())) continue;
    out.push({ id: m.id, text, month, day, at: next.toISOString() });
  }
  return out;
}

/** The evening review: what got done today and what is still open for today or overdue. */
export function daySummary(notes: Note[], now = new Date()): { done: Note[]; open: Note[] } {
  const today = localDay(now);
  const todos = notes.filter((n) => n.kind === "todo" && !n.auto);
  return {
    done: todos.filter((n) => n.done && n.completedAt && localDay(n.completedAt) === today),
    open: todos.filter((n) => !n.done && n.dueAt && localDay(n.dueAt) <= today).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!)),
  };
}
/** The same time of day on the next day (a date-only to-do stays date-only). */
export function tomorrowSameTime(iso: string, now = new Date()): string {
  const d = new Date(iso), t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, d.getHours(), d.getMinutes());
  return t.toISOString();
}

/**
 * The line in the day card when there is no brief yet, by the time of day: before the brief time it says when it comes,
 * later in the day it offers to make one now, and in the evening it sums up the day and looks at tomorrow.
 */
export function heroFallback(o: { now: Date; brief: boolean; briefTime: string; evening: boolean; eveningTime: string; dayOff: boolean;
  done: number; left: number; tomorrow: number; tomorrowFirst?: string }): { text: string; evening: boolean } {
  const mins = o.now.getHours() * 60 + o.now.getMinutes();
  const at = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h! * 60 + m!; };
  const eve = Math.min(o.evening ? at(o.eveningTime) : 18 * 60, 18 * 60);
  if (mins >= eve || o.now.getHours() < 5) {
    const day = o.done || o.left ? `Сегодня сделано: ${o.done}` + (o.left ? `, не успели: ${o.left}.` : ".") : o.dayOff ? "Спокойный день без дел." : "Сегодня дел со сроком не было.";
    const next = o.tomorrow ? ` Завтра дел: ${o.tomorrow}${o.tomorrowFirst ? `, первое — ${o.tomorrowFirst}` : ""}.` : " На завтра дел пока нет.";
    return { text: day + next + (o.left ? " Остаток можно перенести на завтра в «Итоге дня»." : ""), evening: true };
  }
  if (!o.brief) return { text: "Утренняя сводка выключена: включите её в «Автоматике», вкладка «Утро».", evening: false };
  if (mins < at(o.briefTime)) return { text: `Сводка появится в ${o.briefTime}. Нажмите ↻, чтобы составить её сейчас.`, evening: false };
  return { text: o.dayOff ? "Выходной. Нажмите ↻, если хотите короткую сводку на сегодня." : "Сводку на сегодня ещё не составляли. Нажмите ↻, и она появится.", evening: false };
}

/** To-dos moved by the automation at least `after` times (0 = never stuck). */
export function stuckTodos(notes: Note[], after: number): Note[] {
  return after ? notes.filter((n) => n.kind === "todo" && !n.done && (n.rolled ?? 0) >= after) : [];
}

/**
 * Where the quick-entry parser found the date, time and other words it understood: the parts of `input` around the
 * task text it kept. Empty when nothing was understood or the kept text is not a plain piece of the input.
 */
export function recognizedSpans(input: string, kept: string): [number, number][] {
  const k = kept.trim();
  if (!k || k.length >= input.trim().length) return [];
  const at = input.toLowerCase().indexOf(k.toLowerCase());
  if (at < 0) return [];
  const out: [number, number][] = [];
  const push = (a: number, b: number) => {
    while (a < b && /\s/.test(input[a]!)) a++;
    while (b > a && /\s/.test(input[b - 1]!)) b--;
    if (b > a) out.push([a, b]);
  };
  push(0, at);
  push(at + k.length, input.length);
  return out;
}

/** This week (Monday to Sunday): to-dos due in it and how many of them are done; for the hero ring on an empty day. */
export function weekProgress(notes: Note[], now = new Date()): { done: number; total: number } {
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const from = mon.getTime(), to = from + 7 * 86_400_000;
  const inWeek = (iso?: string) => !!iso && Date.parse(iso) >= from && Date.parse(iso) < to;
  const todos = notes.filter((n) => n.kind === "todo" && (inWeek(n.dueAt) || (n.done && inWeek(n.completedAt))));
  return { done: todos.filter((n) => n.done).length, total: todos.length };
}

/**
 * «Спланировать неделю»: open to-dos without a due date spread over the next working days, important first,
 * each day filled up to `dayMinutes` (30 minutes for a to-do without an estimate). Never writes anything.
 */
export function planWeek(notes: Note[], workdays: string[], dayMinutes = 480): { id: string; text: string; day: string }[] {
  const free = notes.filter((n) => n.kind === "todo" && !n.done && !n.dueAt && !n.parentId)
    .sort((a, b) => (a.priority === "high" ? 0 : a.priority === "low" ? 2 : 1) - (b.priority === "high" ? 0 : b.priority === "low" ? 2 : 1) || a.createdAt.localeCompare(b.createdAt));
  const load = new Map<string, number>();
  for (const n of notes) if (n.kind === "todo" && !n.done && n.dueAt) { const k = localDay(n.dueAt); load.set(k, (load.get(k) ?? 0) + (n.estimateMinutes || 30)); }
  const out: { id: string; text: string; day: string }[] = [];
  for (const n of free) {
    const need = n.estimateMinutes || 30;
    // the least loaded day that still has room; ties go to the earlier day
    let best: string | null = null;
    for (const d of workdays) if ((load.get(d) ?? 0) + need <= Math.max(dayMinutes, need) && (best === null || (load.get(d) ?? 0) < (load.get(best) ?? 0))) best = d;
    if (!best) continue;
    load.set(best, (load.get(best) ?? 0) + need);
    out.push({ id: n.id, text: n.text, day: best });
  }
  return out;
}

/** Free minutes of a day: the working hours, an hour less on a short day, half of them on a day off (as the server counts). */
export function dayCapacity(day: string, dayHours: number, daysOff?: DayOff[]): number {
  if (!dayHours) return 0;
  if (awayOn(daysOff, day)) return Math.ceil(dayHours / 2) * 60;
  const pd = prodDay(day);
  const d = new Date(day + "T12:00");
  const work = pd ? pd.kind === "work" || pd.kind === "short" : d.getDay() !== 0 && d.getDay() !== 6;
  return (work ? (pd?.kind === "short" ? Math.max(1, dayHours - 1) : dayHours) : Math.ceil(dayHours / 2)) * 60;
}
/**
 * How full a day is, from the list already on the page (no request): the same numbers as the server's
 * `/api/organizer/load`, with the to-dos to move off an overloaded day (not the important ones, the cheap moves first).
 */
export function dayLoadOf(notes: Note[], day: string, dayHours: number, daysOff?: DayOff[]): DayLoad {
  const capacity = dayCapacity(day, dayHours, daysOff);
  const items = notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && localDay(n.dueAt) === day);
  const mins = (n: Note) => n.estimateMinutes ?? 30;
  const planned = items.reduce((s, n) => s + mins(n), 0);
  const over = capacity > 0 && planned > capacity;
  const move: DayLoad["move"] = [];
  if (over) {
    const rank = (n: Note) => (n.priority === "low" ? 0 : 1) * 2 + (n.dueAt && isDateOnly(n.dueAt) ? 0 : 1);
    let rest = planned;
    for (const n of items.filter((x) => x.priority !== "high").sort((x, y) => rank(x) - rank(y) || mins(y) - mins(x))) {
      if (rest <= capacity) break;
      move.push({ id: n.id, text: n.text, minutes: mins(n) });
      rest -= mins(n);
    }
  }
  const pd = prodDay(day);
  return { day, capacity, planned, over, count: items.length, work: pd ? pd.kind === "work" || pd.kind === "short" : true, move };
}

export interface MonthItem { id: string; text: string; at: string; kind: "todo" | "reminder"; done: boolean }
/** The calendar's month: to-dos by due date and reminders by time, and the overloaded days. Built on the page, no request. */
export function monthItems(org: { notes: Note[]; reminders: Reminder[]; daysOff?: DayOff[] }, month: string, dayHours: number): { items: MonthItem[]; heavyDays: string[] } {
  const inMonth = (iso: string) => localDay(iso).slice(0, 7) === month;
  const items: MonthItem[] = [
    ...org.notes.filter((n) => n.kind === "todo" && n.dueAt && inMonth(n.dueAt)).map((n) => ({ id: n.id, text: n.text, at: n.dueAt!, kind: "todo" as const, done: n.done })),
    ...org.reminders.filter((r) => inMonth(r.at)).map((r) => ({ id: r.id, text: r.text, at: r.at, kind: "reminder" as const, done: r.status === "done" })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const days = [...new Set(items.filter((x) => x.kind === "todo" && !x.done).map((x) => localDay(x.at)))];
  return { items, heavyDays: dayHours ? days.filter((d) => dayLoadOf(org.notes, d, dayHours, org.daysOff).over) : [] };
}

/** The text cut into pieces, with the places where `query` occurs marked (case does not matter). */
export function markParts(text: string, query: string): [string, boolean][] {
  const q = query.trim().toLowerCase();
  if (!q) return [[text, false]];
  const out: [string, boolean][] = [];
  const low = text.toLowerCase();
  let at = 0;
  for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, i + q.length)) {
    if (i > at) out.push([text.slice(at, i), false]);
    out.push([text.slice(i, i + q.length), true]);
    at = i + q.length;
  }
  if (at < text.length) out.push([text.slice(at), false]);
  return out.length ? out : [[text, false]];
}

/** The days a to-do can be moved to from its row: today, tomorrow, the coming Monday and a week from today. */
export function moveTargets(now = new Date()): { key: string; label: string }[] {
  const at = (n: number) => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12));
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  const all = [{ key: at(0), label: "Сегодня" }, { key: at(1), label: "Завтра" }, { key: at(toMonday), label: "В понедельник" }, { key: at(7), label: "Через неделю" }];
  // on Sunday Monday is tomorrow, on Monday it is a week from today: each day once
  return all.filter((x, i) => all.findIndex((y) => y.key === x.key) === i);
}

/** The open to-dos with a project (or a goal), for the filter chips: name and how many. */
export function projectCounts(notes: Note[], goalTitle: (id: string) => string | undefined): { id: string; label: string; n: number }[] {
  const m = new Map<string, number>();
  for (const n of notes) if (n.kind === "todo" && !n.done && n.project) m.set(n.project, (m.get(n.project) ?? 0) + 1);
  return [...m].map(([id, n]) => { const g = goalTitle(id); return { id, label: g ? "◎ " + g : "#" + id, n }; }).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}
export interface ProjectInfo { id: string; label: string; open: number; done: number; total: number; goal: boolean; color?: string; dueAt?: string; area: Area }
/**
 * The «Проекты» card: every project that still has something open (or a deadline set), with its progress, colour,
 * deadline and sphere. Goals keep their own card, so they are marked.
 */
export function projectList(notes: Note[], projects: ProjectMeta[], goalTitle: (id: string) => string | undefined): ProjectInfo[] {
  const by = new Map<string, Note[]>();
  for (const n of notes) if (n.kind === "todo" && n.project) { const l = by.get(n.project); if (l) l.push(n); else by.set(n.project, [n]); }
  const out: ProjectInfo[] = [];
  for (const [id, list] of by) {
    const open = list.filter((n) => !n.done).length;
    const meta = projects.find((p) => p.name.toLowerCase() === id.toLowerCase());
    if (!open && !meta?.dueAt) continue;
    const g = goalTitle(id);
    out.push({ id, label: g ?? id, open, done: list.length - open, total: list.length, goal: !!g, ...(meta?.color ? { color: meta.color } : {}), ...(meta?.dueAt ? { dueAt: meta.dueAt } : {}), area: meta?.area ?? areaOf({ project: id }, projects) });
  }
  return out.sort((a, b) => Number(a.goal) - Number(b.goal) || b.open - a.open || a.label.localeCompare(b.label, "ru"));
}

/**
 * Fired reminders the owner pressed «Готово» on stay hidden even when the server still reports them as due
 * (the request failed or the saved file was not replaced): `resend` are the ones to dismiss again,
 * `keep` the remembered ids that still matter (the rest are forgotten so the list stays short).
 */
export function dropDismissed(reminders: Reminder[], hidden: ReadonlySet<string>): { shown: Reminder[]; resend: string[]; keep: string[] } {
  const resend = reminders.filter((r) => r.status === "due" && hidden.has(r.id)).map((r) => r.id);
  const gone = new Set(resend);
  return { shown: reminders.filter((r) => !gone.has(r.id)), resend, keep: resend };
}
