import { describe, expect, it } from "vitest";
import type { Note, Reminder } from "../src/api";
import { buildTasks, isDateOnly, localDay, planWeek, recognizedSpans, toLocalInput, weekProgress } from "../src/pages/tasks-model";

// Суббота, 10 октября 2026, 12:00 по местному времени
const now = new Date(2026, 9, 10, 12, 0);
const iso = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const note = (id: string, kind: Note["kind"], extra: Partial<Note> = {}): Note => ({ id, kind, text: id, done: false, createdAt: iso(1, 10), ...extra });
const rem = (id: string, status: Reminder["status"], at: string, extra: Partial<Reminder> = {}): Reminder => ({ id, text: id, at, createdAt: at, status, ...extra });

describe("страница «Дела»", () => {
  const org = {
    notes: [
      note("хлеб", "todo"), note("важное", "todo", { priority: "high", createdAt: iso(5, 10) }),
      note("отчёт", "todo", { dueAt: iso(10, 9) }), note("звонок", "todo", { dueAt: iso(10, 23, 59) }),
      note("сдать", "todo", { dueAt: iso(11, 23, 59) }), note("отпуск", "todo", { dueAt: iso(20, 23, 59) }),
      note("молоко", "todo", { done: true, completedAt: iso(10, 8) }),
      note("шаг 1", "todo", { parentId: "отпуск" }), note("шаг 2", "todo", { parentId: "отпуск", done: true }),
      note("сирота", "todo", { parentId: "удалённое" }),
      note("код", "note", { createdAt: iso(1, 9) }), note("идея", "note", { createdAt: iso(2, 9) }),
    ],
    reminders: [rem("вечером", "scheduled", iso(10, 19)), rem("утром", "scheduled", iso(11, 9), { repeat: "daily" }), rem("сейчас", "due", iso(10, 8)), rem("было", "done", iso(9, 8))],
  };
  it("одна лента по дням: просрочено, сегодня, завтра, позже; без срока отдельно", () => {
    const t = buildTasks(org, "all", "", now);
    expect(t.due.map((x) => x.id)).toEqual(["сейчас"]);
    const ids = (xs: { type: string; note?: Note; reminder?: Reminder }[]) => xs.map((x) => (x.note ?? x.reminder)!.id);
    expect(ids(t.overdue)).toEqual(["отчёт"]);
    expect(ids(t.today)).toEqual(["вечером", "звонок"]);
    expect(ids(t.tomorrow)).toEqual(["утром", "сдать"]);
    expect(ids(t.later)).toEqual(["отпуск"]);
    expect(t.someday.map((x) => x.id)).toEqual(["важное", "хлеб", "сирота"]);
    expect(t.notes.map((x) => x.id)).toEqual(["идея", "код"]);
    expect(t.finished.todos.map((x) => x.id)).toEqual(["молоко"]);
    expect(t.finished.reminders.map((x) => x.id)).toEqual(["было"]);
    expect(t.summary).toEqual({ today: 2, overdue: 1, doneToday: 1 });
  });
  it("подзадачи под своим делом; без родителя — обычное дело", () => {
    const t = buildTasks(org, "all", "", now);
    expect(t.children["отпуск"]!.map((x) => x.id)).toEqual(["шаг 1", "шаг 2"]);
    expect(t.someday.map((x) => x.id)).not.toContain("шаг 1");
    // при поиске подзадачи видны сами по себе
    expect(buildTasks(org, "all", "шаг", now).someday.map((x) => x.id)).toEqual(["шаг 1"]);
  });
  it("фильтр и поиск; счётчики не зависят от поиска", () => {
    const only = buildTasks(org, "reminder", "", now);
    expect([only.someday.length, only.notes.length, only.due.length, only.overdue.length]).toEqual([0, 0, 1, 0]);
    expect(only.today.map((x) => x.type)).toEqual(["reminder"]);
    const found = buildTasks(org, "all", "ХЛЕ", now);
    expect(found.someday.map((x) => x.id)).toEqual(["хлеб"]);
    expect(found.today).toEqual([]);
    expect(found.counts).toEqual(buildTasks(org, "all", "", now).counts);
  });
  it("местные дни и время", () => {
    expect(toLocalInput(new Date(2026, 9, 10, 7, 5).toISOString())).toBe("2026-10-10T07:05");
    expect(localDay(new Date(2026, 9, 10, 0, 30))).toBe("2026-10-10");
    expect(isDateOnly(iso(10, 23, 59))).toBe(true);
    expect(isDateOnly(iso(10, 9))).toBe(false);
  });
});

describe("ввод, неделя и план недели", () => {
  it("подсвечивает распознанное вокруг текста дела", () => {
    const s = "завтра в 10 позвонить маме";
    expect(recognizedSpans(s, "позвонить маме").map(([a, b]) => s.slice(a, b))).toEqual(["завтра в 10"]);
    const t = "отчёт в пятницу !";
    expect(recognizedSpans(t, "Отчёт").map(([a, b]) => t.slice(a, b))).toEqual(["в пятницу !"]);
    expect(recognizedSpans("просто дело", "просто дело")).toEqual([]);
  });
  it("считает дела этой недели", () => {
    const notes = [note("a", "todo", { dueAt: iso(12, 10) }), note("b", "todo", { dueAt: iso(8, 10), done: true, completedAt: iso(8, 11) }), note("c", "todo", { dueAt: iso(20, 10) })];
    // неделя с 5 по 11 октября
    expect(weekProgress(notes, now)).toEqual({ done: 1, total: 1 });
  });
  it("раскладывает дела без срока по рабочим дням, важные первыми", () => {
    const notes = [note("x", "todo"), note("y", "todo", { priority: "high" }), note("z", "todo", { estimateMinutes: 400 }), note("busy", "todo", { dueAt: iso(12, 10), estimateMinutes: 450 })];
    const p = planWeek(notes, ["2026-10-12", "2026-10-13"], 480);
    expect(p[0]).toMatchObject({ id: "y", day: "2026-10-13" });
    expect(p.find((x) => x.id === "z")?.day).toBe("2026-10-13");
    expect(p.find((x) => x.id === "x")?.day).toBe("2026-10-13");
    expect(planWeek([note("big", "todo", { estimateMinutes: 600 })], ["2026-10-12"], 480)).toEqual([{ id: "big", text: "big", day: "2026-10-12" }]);
  });
});
