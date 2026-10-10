/** Pure model behind the "Дела" page (tested in test/tasks-model.test.ts). */
import type { Note, Reminder, Repeat } from "../api";

export type TaskFilter = "all" | "todo" | "note" | "reminder";
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
export function buildTasks(org: { notes: Note[]; reminders: Reminder[] }, filter: TaskFilter = "all", query = "", now = new Date()): TaskView {
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

  const open = show("todo") ? org.notes.filter((n) => n.kind === "todo" && !n.done && !isChild(n) && hit(n.text)) : [];
  const planned = show("reminder") ? org.reminders.filter((r) => r.status === "scheduled" && hit(r.text)) : [];
  const timed: TimedItem[] = [
    ...open.filter((n) => n.dueAt).map((n) => ({ type: "todo" as const, note: n, at: Date.parse(n.dueAt!) })),
    ...planned.map((r) => ({ type: "reminder" as const, reminder: r, at: Date.parse(r.at) })),
  ].sort((a, b) => a.at - b.at);
  const view: TaskView = {
    due: show("reminder") ? org.reminders.filter((r) => r.status === "due" && hit(r.text)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : [],
    overdue: [], today: [], tomorrow: [], later: [],
    someday: open.filter((n) => !n.dueAt).sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || Date.parse(a.createdAt) - Date.parse(b.createdAt)),
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
