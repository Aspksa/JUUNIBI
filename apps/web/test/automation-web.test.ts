import { describe, expect, it } from "vitest";
import { daySummary, memoryDates, tomorrowSameTime } from "../src/pages/tasks-model";
import { taskTextFrom } from "../src/pages/quick-entry";
import type { Note, Reminder } from "../src/api";

const now = new Date(2026, 9, 10, 20, 0);
const todo = (id: string, extra: Partial<Note>): Note => ({ id, kind: "todo", text: id, done: false, createdAt: now.toISOString(), ...extra });

describe("даты из памяти", () => {
  it("находит дни рождения и годовщины словами и числами", () => {
    const mem = [
      { id: "a", text: "У мамы день рождения 12 марта", status: "active" },
      { id: "b", text: "Годовщина свадьбы 05.06.2015", status: "active" },
      { id: "c", text: "ДР Пети 1 ноября" },
      { id: "d", text: "Любит кофе 3 раза в день" },
      { id: "e", text: "День рождения 31.02", status: "active" },
      { id: "f", text: "Именины 9 октября", status: "pending" },
    ];
    const out = memoryDates(mem, [], now);
    expect(out.map((d) => [d.id, d.day, d.month])).toEqual([["a", 12, 3], ["b", 5, 6], ["c", 1, 11]]);
    expect(new Date(out[0]!.at).getFullYear()).toBe(2027); // март уже прошёл
    expect(new Date(out[2]!.at)).toEqual(new Date(2026, 10, 1, 9, 0));
  });
  it("пропускает даты, по которым уже есть ежегодное напоминание", () => {
    const r: Reminder = { id: "r", text: "У мамы день рождения 12 марта", at: now.toISOString(), createdAt: now.toISOString(), status: "scheduled", repeat: "yearly" };
    expect(memoryDates([{ id: "a", text: "У мамы день рождения 12 марта" }], [r], now)).toEqual([]);
  });
});

describe("итог дня", () => {
  it("делит на сделанное сегодня и оставшееся на сегодня или просроченное", () => {
    const notes = [
      todo("done", { done: true, completedAt: new Date(2026, 9, 10, 11).toISOString() }),
      todo("old-done", { done: true, completedAt: new Date(2026, 9, 9, 11).toISOString() }),
      todo("today", { dueAt: new Date(2026, 9, 10, 23, 59).toISOString() }),
      todo("late", { dueAt: new Date(2026, 9, 8, 10).toISOString() }),
      todo("tomorrow", { dueAt: new Date(2026, 9, 11, 10).toISOString() }),
      todo("brief", { auto: "brief", dueAt: new Date(2026, 9, 10, 9).toISOString() }),
    ];
    const s = daySummary(notes, now);
    expect(s.done.map((n) => n.id)).toEqual(["done"]);
    expect(s.open.map((n) => n.id)).toEqual(["late", "today"]);
    expect(new Date(tomorrowSameTime(new Date(2026, 9, 8, 10).toISOString(), now))).toEqual(new Date(2026, 9, 11, 10));
  });
});

describe("«В дела» из чата", () => {
  it("берёт выделение, иначе первое предложение без разметки", () => {
    expect(taskTextFrom("Длинный ответ", "  завтра в 10   позвонить маме ")).toBe("завтра в 10 позвонить маме");
    expect(taskTextFrom("**Купить молоко.** Потом всё остальное.")).toBe("Купить молоко");
    expect(taskTextFrom("1. Сдать отчёт в пятницу\n2. Второе")).toBe("Сдать отчёт в пятницу");
    expect(taskTextFrom("```js\ncode\n```")).toBe("");
  });
});
