import { describe, expect, it, vi } from "vitest";
import type { Note, Reminder } from "./organizer";
import { InsightsService } from "./insights-service";

const todo = (id: string, text: string, patch: Partial<Note> = {}): Note => ({
  id,
  kind: "todo",
  text,
  done: false,
  createdAt: "2026-10-01T08:00:00Z",
  ...patch,
});

describe("InsightsService", () => {
  it("builds calendar/statistics/recommendations without mutating source state", () => {
    const notes: Note[] = [
      todo("overdue", "Просрочено", {
        priority: "high",
        dueAt: "2026-10-09T12:00:00Z",
      }),
      todo("done", "Готово", {
        done: true,
        dueAt: "2026-10-10T10:00:00Z",
        completedAt: "2026-10-10T11:00:00Z",
      }),
      { id: "note", kind: "note", text: "Заметка", done: false, createdAt: "2026-10-01T08:00:00Z" },
    ];
    const reminders: Reminder[] = [{
      id: "r1",
      text: "Напоминание",
      at: "2026-10-15T09:00:00Z",
      createdAt: "2026-10-01T08:00:00Z",
      status: "scheduled",
    }];
    const beforeNotes = structuredClone(notes);
    const beforeReminders = structuredClone(reminders);
    const dayLoad = vi.fn(() => ({ over: false }));

    const service = new InsightsService({
      getNotes: () => notes,
      getReminders: () => reminders,
      planToday: () => ({
        suggested: [{
          id: "overdue",
          text: "Просрочено",
          score: 80,
          reason: "Просрочено",
        }],
      }),
      dayLoad,
    });

    const report = service.month("2026-10", Date.parse("2026-10-10T12:00:00Z"));
    expect(report.statistics).toEqual({
      all: 2,
      completed: 1,
      open: 1,
      overdue: 1,
      completedThisMonth: 1,
      completionPercent: 50,
    });
    expect(report.items.map((item) => item.kind)).toEqual(["todo", "todo", "reminder"]);
    expect(report.brainRecommendations[0]).toMatchObject({
      id: "overdue",
      reason: "Просрочено",
      evidence: "Срок и приоритет задачи",
      source: "local-task-metrics",
    });
    expect(report.advisoryOnly).toBe(true);
    expect(notes).toEqual(beforeNotes);
    expect(reminders).toEqual(beforeReminders);
  });

  it("marks only open overloaded task-days as heavy", () => {
    const notes: Note[] = [
      todo("heavy", "Большое", { dueAt: "2026-10-16T12:00:00Z" }),
      todo("done", "Сделано", { done: true, dueAt: "2026-10-17T12:00:00Z" }),
      todo("outside", "Ноябрь", { dueAt: "2026-11-01T12:00:00Z" }),
    ];
    const dayLoad = vi.fn((day: string) => ({ over: day === "2026-10-16" }));

    const service = new InsightsService({
      getNotes: () => notes,
      getReminders: () => [],
      planToday: () => ({ suggested: [] }),
      dayLoad,
    });

    expect(service.month("2026-10", Date.parse("2026-10-01T00:00:00Z")).heavyDays)
      .toEqual(["2026-10-16"]);
    expect(dayLoad).toHaveBeenCalledTimes(1);
  });

  it("limits grounded recommendations to five", () => {
    const service = new InsightsService({
      getNotes: () => [],
      getReminders: () => [],
      planToday: () => ({
        suggested: Array.from({ length: 8 }, (_, index) => ({
          id: String(index),
          text: "Task " + index,
          score: 10 - index,
          reason: "Очередь задач",
        })),
      }),
      dayLoad: () => ({ over: false }),
    });

    expect(service.month("2026-10", Date.now()).brainRecommendations).toHaveLength(5);
  });

  it("rejects invalid month values", () => {
    const service = new InsightsService({
      getNotes: () => [],
      getReminders: () => [],
      planToday: () => ({ suggested: [] }),
      dayLoad: () => ({ over: false }),
    });

    expect(() => service.month("2026-13", Date.now())).toThrow(/YYYY-MM/);
    expect(() => service.month("bad", Date.now())).toThrow(/YYYY-MM/);
  });
});
