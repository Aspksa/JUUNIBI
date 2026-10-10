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

export interface TaskSections {
  due: Reminder[];
  todos: Note[];
  reminders: Reminder[];
  notes: Note[];
  finished: { todos: Note[]; reminders: Reminder[] };
  counts: Record<TaskFilter, number>;
}
/** What the page shows, in order: fired reminders, open to-dos, planned reminders, notes, then the finished ones. */
export function buildTasks(org: { notes: Note[]; reminders: Reminder[] }, filter: TaskFilter = "all", query = ""): TaskSections {
  const q = query.trim().toLowerCase();
  const hit = (t: string) => !q || t.toLowerCase().includes(q);
  const notes = org.notes.filter((n) => hit(n.text));
  const rem = org.reminders.filter((r) => hit(r.text));
  const byTime = (a: Reminder, b: Reminder) => Date.parse(a.at) - Date.parse(b.at);
  const newest = <T extends { createdAt: string }>(a: T, b: T) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  const all = {
    due: rem.filter((r) => r.status === "due").sort(byTime),
    todos: notes.filter((n) => n.kind === "todo" && !n.done),
    reminders: rem.filter((r) => r.status === "scheduled").sort(byTime),
    notes: notes.filter((n) => n.kind === "note").sort(newest),
    finished: {
      todos: notes.filter((n) => n.kind === "todo" && n.done),
      reminders: rem.filter((r) => r.status === "done").sort((a, b) => Date.parse(b.firedAt ?? b.at) - Date.parse(a.firedAt ?? a.at)).slice(0, 20),
    },
  };
  const counts = {
    all: org.notes.filter((n) => !(n.kind === "todo" && n.done)).length + org.reminders.filter((r) => r.status !== "done").length,
    todo: org.notes.filter((n) => n.kind === "todo" && !n.done).length,
    note: org.notes.filter((n) => n.kind === "note").length,
    reminder: org.reminders.filter((r) => r.status !== "done").length,
  };
  const show = (f: TaskFilter) => filter === "all" || filter === f;
  return {
    due: show("reminder") ? all.due : [],
    todos: show("todo") ? all.todos : [],
    reminders: show("reminder") ? all.reminders : [],
    notes: show("note") ? all.notes : [],
    finished: { todos: show("todo") ? all.finished.todos : [], reminders: show("reminder") ? all.finished.reminders : [] },
    counts,
  };
}
