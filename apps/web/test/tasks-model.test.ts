import { describe, expect, it } from "vitest";
import type { Note, Reminder } from "../src/api";
import { buildTasks, toLocalInput } from "../src/pages/tasks-model";

const note = (id: string, kind: Note["kind"], done = false, createdAt = "2026-10-01T10:00:00Z"): Note => ({ id, kind, text: id, done, createdAt });
const rem = (id: string, status: Reminder["status"], at: string, extra: Partial<Reminder> = {}): Reminder => ({ id, text: id, at, createdAt: at, status, ...extra });

describe("страница «Дела»", () => {
  const org = {
    notes: [note("хлеб", "todo"), note("молоко", "todo", true), note("код", "note", false, "2026-10-01T09:00:00Z"), note("идея", "note", false, "2026-10-02T09:00:00Z")],
    reminders: [rem("позже", "scheduled", "2026-10-12T10:00:00Z"), rem("раньше", "scheduled", "2026-10-11T10:00:00Z", { repeat: "daily" }), rem("сейчас", "due", "2026-10-10T08:00:00Z"), rem("было", "done", "2026-10-09T08:00:00Z")],
  };
  it("раскладывает по разделам и считает", () => {
    const t = buildTasks(org);
    expect(t.due.map((x) => x.id)).toEqual(["сейчас"]);
    expect(t.todos.map((x) => x.id)).toEqual(["хлеб"]);
    expect(t.reminders.map((x) => x.id)).toEqual(["раньше", "позже"]);
    expect(t.notes.map((x) => x.id)).toEqual(["идея", "код"]);
    expect(t.finished.todos.map((x) => x.id)).toEqual(["молоко"]);
    expect(t.finished.reminders.map((x) => x.id)).toEqual(["было"]);
    expect(t.counts).toEqual({ all: 6, todo: 1, note: 2, reminder: 3 });
  });
  it("фильтр и поиск", () => {
    const only = buildTasks(org, "reminder");
    expect([only.todos.length, only.notes.length, only.reminders.length, only.due.length]).toEqual([0, 0, 2, 1]);
    const found = buildTasks(org, "all", "ХЛЕ");
    expect(found.todos.map((x) => x.id)).toEqual(["хлеб"]);
    expect(found.reminders).toEqual([]);
    expect(found.counts.all).toBe(6); // счётчики не зависят от поиска
  });
  it("время для поля ввода — местное, с минутами", () => {
    const d = new Date(2026, 9, 10, 7, 5);
    expect(toLocalInput(d.toISOString())).toBe("2026-10-10T07:05");
  });
});
