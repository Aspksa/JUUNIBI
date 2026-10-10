/** Pure model behind the "Дела" page (tested in test/tasks-model.test.ts). */
import type { Note, Reminder, Repeat } from "../api";

export type TaskFilter = "all" | "todo" | "note" | "reminder";
export const REPEAT_LABEL: Record<Repeat, string> = { daily: "каждый день", weekdays: "по будням", weekly: "каждую неделю", monthly: "каждый месяц", every3days: "каждые 3 дня" };
export const REPEAT_OPTIONS: [Repeat | "none", string][] = [["none", "Один раз"], ["daily", "Каждый день"], ["weekdays", "По будням"], ["weekly", "Каждую неделю"], ["monthly", "Каждый месяц"], ["every3days", "Каждые 3 дня"]];

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
    notes: show("note") ? org.notes.filter((n) => n.kind === "note" && hit(n.text)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) : [],
    children,
    finished: {
      todos: show("todo") ? org.notes.filter((n) => n.kind === "todo" && n.done && !isChild(n) && hit(n.text)).sort((a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt)).slice(0, 30) : [],
      reminders: show("reminder") ? org.reminders.filter((r) => r.status === "done" && hit(r.text)).sort((a, b) => Date.parse(b.firedAt ?? b.at) - Date.parse(a.firedAt ?? a.at)).slice(0, 20) : [],
    },
    counts: {
      all: org.notes.filter((n) => !(n.kind === "todo" && n.done)).length + org.reminders.filter((r) => r.status !== "done").length,
      todo: org.notes.filter((n) => n.kind === "todo" && !n.done).length,
      note: org.notes.filter((n) => n.kind === "note").length,
      reminder: org.reminders.filter((r) => r.status !== "done").length,
    },
    summary: { today: 0, overdue: 0, doneToday: org.notes.filter((n) => n.kind === "todo" && n.done && n.completedAt && localDay(n.completedAt) === todayKey).length },
  };
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
