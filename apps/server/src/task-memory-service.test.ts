import { describe, expect, it } from "vitest";
import type { Note, TaskEvent } from "./organizer";
import { TaskMemoryService } from "./task-memory-service";

const todo = (id: string, text: string, patch: Partial<Note> = {}): Note => ({
  id,
  kind: "todo",
  text,
  done: false,
  createdAt: "2026-10-01T09:00:00Z",
  ...patch,
});

const event = (
  kind: TaskEvent["kind"],
  note: Note,
  patch: Partial<TaskEvent> = {},
): TaskEvent => ({
  at: "2026-10-10T10:00:00Z",
  id: note.id,
  kind,
  text: note.text,
  todo: true,
  ...patch,
});

describe("TaskMemoryService", () => {
  it("learns repeated moves as friction and keeps learned estimates from completed similar tasks", () => {
    const memory = new TaskMemoryService();
    for (let index = 0; index < 3; index++) {
      const note = todo("r" + index, "Подготовить ежемесячный отчёт", {
        project: "Финансы",
        estimateMinutes: 60,
        dueAt: "2026-10-10T12:00:00Z",
      });
      memory.observe(event("add", note), note, "work");
      memory.observe(event("move", note, {
        from: "2026-10-09T12:00:00Z",
        to: "2026-10-10T12:00:00Z",
      }), note, "work");
      memory.observe(event("done", note, { at: "2026-10-10T11:00:00Z" }), note, "work");
    }

    const recall = memory.recall(todo("new", "Подготовить квартальный отчёт", { project: "Финансы" }), "work");
    expect(recall.learnedEstimateMinutes).toBe(60);
    expect(recall.riskBoost).toBeGreaterThan(0);
    expect(recall.reasons).toContain("Похожие дела часто переносились");
  });

  it("does not count initial scheduling from no due date as procrastination", () => {
    const memory = new TaskMemoryService();
    const note = todo("a", "Позвонить поставщику");
    memory.observe(event("add", note), note, "work");
    memory.observe(event("move", note, {
      from: null,
      to: "2026-10-12T10:00:00Z",
    }), note, "work");

    expect(memory.recall(todo("b", "Позвонить поставщику"), "work").friction).toBe(0);
  });

  it("learns project deadline risk only from confirmed completed outcomes", () => {
    const memory = new TaskMemoryService();
    for (let index = 0; index < 3; index++) {
      const note = todo("late" + index, "Закрыть заявку " + index, {
        project: "Клиенты",
        dueAt: "2026-10-09T12:00:00Z",
      });
      memory.observe(event("done", note, { at: "2026-10-10T12:00:00Z" }), note, "work");
    }
    const recall = memory.recall(todo("next", "Проверить договор", { project: "Клиенты" }), "work");
    expect(recall.reasons).toContain("В проекте «Клиенты» сроки часто срывались");
    expect(recall.riskBoost).toBeGreaterThanOrEqual(7);
  });

  it("round-trips a durable snapshot and ignores invalid buckets", () => {
    const memory = new TaskMemoryService();
    const note = todo("a", "Сверить документы", { estimateMinutes: 45 });
    memory.observe(event("done", note), note, "personal");

    const copy = new TaskMemoryService();
    expect(copy.load(memory.snapshot())).toBe(true);
    expect(copy.summary().totals.observations).toBe(1);

    expect(copy.load({ version: 1, observations: 2, buckets: [{ key: "", kind: "bad" }] })).toBe(true);
    expect(copy.summary().totals.buckets).toBe(0);
  });

  it("rebuilds memory from legacy history when no snapshot exists", () => {
    const memory = new TaskMemoryService();
    const note = todo("a", "Подготовить отчёт", {
      project: "Работа",
      estimateMinutes: 30,
      dueAt: "2026-10-10T12:00:00Z",
      completedAt: "2026-10-10T11:00:00Z",
      done: true,
    });
    const history: TaskEvent[] = [
      event("add", note, { at: "2026-10-09T10:00:00Z" }),
      event("done", note, { at: "2026-10-10T11:00:00Z" }),
    ];

    memory.rebuild(history, [note], () => "work");
    expect(memory.summary().totals.completed).toBe(1);
    expect(memory.recall(todo("b", "Подготовить отчёт", { project: "Работа" }), "work").confidence).toBeGreaterThan(0);
  });

  it("keeps summary descriptive and read-only", () => {
    const memory = new TaskMemoryService();
    const note = todo("a", "Проверить смету");
    memory.observe(event("add", note), note, "personal");
    const summary = memory.summary();
    expect(summary.note).toMatch(/ничего не выполняет сама/);
    expect(summary.totals.observations).toBe(1);
  });
});
