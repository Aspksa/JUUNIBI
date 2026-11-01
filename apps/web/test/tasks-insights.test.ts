import { describe, expect, it } from "vitest";
import { taskInsights } from "../src/pages/tasks-insights";
import type { Note } from "../src/api";
const now = Date.parse("2026-11-01T12:00:00Z");
const task = (id: string, text: string, extra: Partial<Note> = {}): Note => ({ id, text, kind: "todo", done: false, createdAt: "2026-10-01T12:00:00Z", ...extra });
describe("task intelligence", () => {
  it("detects duplicate tasks without modifying their contents", () => {
    const notes = [task("a", "Позвонить  врачу"), task("b", "позвонить врачу")];
    expect(taskInsights(notes, now).find(x => x.kind === "duplicate")?.relatedId).toBe("a");
    expect(notes[1]!.text).toBe("позвонить врачу");
  });
  it("flags overdue, stalled and soon due tasks", () => {
    const notes = [task("a", "Позвонить", { dueAt: "2026-10-31T12:00:00Z", status: "doing" }), task("b", "Письмо", { dueAt: "2026-11-02T10:00:00Z" })];
    const kinds = taskInsights(notes, now).map(x => x.kind);
    expect(kinds).toContain("overdue");
    expect(kinds).toContain("stalled");
    expect(kinds).toContain("priority");
  });
  it("ignores completed tasks", () => {
    expect(taskInsights([task("a", "Готово", { done: true })], now)).toEqual([]);
  });
});
