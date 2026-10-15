import type { Note, Reminder } from "./organizer";

const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

const localKey = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export interface InsightCalendarItem {
  id: string;
  text: string;
  at: string;
  kind: "todo" | "reminder";
  done: boolean;
}

export interface InsightRecommendation {
  id: string;
  text: string;
  score: number;
  reason: string;
  evidence: "Срок и приоритет задачи";
  source: "local-task-metrics";
}

export interface InsightsReport {
  month: string;
  items: InsightCalendarItem[];
  heavyDays: string[];
  statistics: {
    all: number;
    completed: number;
    open: number;
    overdue: number;
    completedThisMonth: number;
    completionPercent: number;
  };
  brainRecommendations: InsightRecommendation[];
  advisoryOnly: true;
}

export interface InsightsServiceOptions {
  getNotes(): readonly Note[];
  getReminders(): readonly Reminder[];
  planToday(now: number): {
    suggested: Array<{ id: string; text: string; score: number; reason: string }>;
  };
  dayLoad(day: string, now: number): { over: boolean };
}

/**
 * Deterministic productivity/calendar analytics.
 *
 * This service is deliberately read-only: it does not save state, call a model or execute actions.
 */
export class InsightsService {
  constructor(private readonly options: InsightsServiceOptions) {}

  month(month: string, now: number): InsightsReport {
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad("Месяц: YYYY-MM");

    const [year, value] = month.split("-").map(Number);
    const begin = new Date(year!, value! - 1, 1).getTime();
    const end = new Date(year!, value!, 1).getTime();

    const notes = this.options.getNotes();
    const reminders = this.options.getReminders();

    const items: InsightCalendarItem[] = [
      ...notes
        .filter((note) =>
          note.kind === "todo" &&
          note.dueAt &&
          Date.parse(note.dueAt) >= begin &&
          Date.parse(note.dueAt) < end
        )
        .map((note) => ({
          id: note.id,
          text: note.text,
          at: note.dueAt!,
          kind: "todo" as const,
          done: note.done,
        })),
      ...reminders
        .filter((reminder) => Date.parse(reminder.at) >= begin && Date.parse(reminder.at) < end)
        .map((reminder) => ({
          id: reminder.id,
          text: reminder.text,
          at: reminder.at,
          kind: "reminder" as const,
          done: reminder.status === "done",
        })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    const todos = notes.filter((note) => note.kind === "todo");
    const finished = todos.filter((note) => note.done);
    const overdue = todos.filter(
      (note) => !note.done && note.dueAt && Date.parse(note.dueAt) < now,
    );
    const completedThisMonth = finished.filter(
      (note) =>
        note.completedAt &&
        Date.parse(note.completedAt) >= begin &&
        Date.parse(note.completedAt) < end,
    ).length;

    const plan = this.options.planToday(now);
    const heavyDays = [
      ...new Set(
        items
          .filter((item) => item.kind === "todo" && !item.done)
          .map((item) => localKey(Date.parse(item.at))),
      ),
    ].filter((day) => this.options.dayLoad(day, now).over);

    return {
      month,
      items,
      heavyDays,
      statistics: {
        all: todos.length,
        completed: finished.length,
        open: todos.length - finished.length,
        overdue: overdue.length,
        completedThisMonth,
        completionPercent: todos.length
          ? Math.round(100 * finished.length / todos.length)
          : 0,
      },
      brainRecommendations: plan.suggested.slice(0, 5).map((item) => ({
        ...item,
        evidence: "Срок и приоритет задачи",
        source: "local-task-metrics",
      })),
      advisoryOnly: true,
    };
  }
}
