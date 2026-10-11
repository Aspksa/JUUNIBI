import { describe, expect, it } from "vitest";
import type { Note, Reminder } from "../src/api";
import { dayCapacity, dayLoadOf, markParts, monthItems, moveTargets, projectCounts } from "../src/pages/tasks-model";

const iso = (m: number, d: number, h: number, min = 0) => new Date(2026, m, d, h, min).toISOString();
const todo = (id: string, extra: Partial<Note> = {}): Note => ({ id, kind: "todo", text: id, done: false, createdAt: iso(9, 1, 10), ...extra });
const rem = (id: string, at: string, extra: Partial<Reminder> = {}): Reminder => ({ id, text: id, at, createdAt: at, status: "scheduled", ...extra });

describe("«Дела» без запросов к серверу", () => {
  it("свободные часы дня: рабочий, сокращённый, выходной и выключенный подсчёт", () => {
    expect(dayCapacity("2026-10-12", 8)).toBe(480); // понедельник
    expect(dayCapacity("2026-10-11", 8)).toBe(240); // воскресенье: половина
    expect(dayCapacity("2026-12-31", 8)).toBe(240); // 31 декабря 2026 — выходной (перенос)
    expect(dayCapacity("2026-10-12", 0)).toBe(0);
  });
  it("загрузка дня считается как на сервере и предлагает перенести лишнее, не трогая важное", () => {
    const notes = [todo("a", { dueAt: iso(9, 12, 10), estimateMinutes: 300, priority: "high" }), todo("b", { dueAt: iso(9, 12, 23, 59), estimateMinutes: 120 }),
      todo("c", { dueAt: iso(9, 12, 15), estimateMinutes: 120 }), todo("готово", { dueAt: iso(9, 12, 11), done: true, estimateMinutes: 600 })];
    const l = dayLoadOf(notes, "2026-10-12", 8);
    expect(l).toMatchObject({ capacity: 480, planned: 540, over: true, count: 3, work: true });
    expect(l.move.map((x) => x.id)).toEqual(["b"]);
  });
  it("месяц календаря: дела по сроку, напоминания по времени, перегруженные дни", () => {
    const org = { notes: [todo("x", { dueAt: iso(9, 12, 10), estimateMinutes: 600 }), todo("y", { dueAt: iso(10, 2, 10) }), todo("без срока")],
      reminders: [rem("r", iso(9, 5, 9)), rem("старое", iso(8, 30, 9), { status: "done" })] };
    const m = monthItems(org, "2026-10", 8);
    expect(m.items.map((x) => x.id)).toEqual(["r", "x"]);
    expect(m.heavyDays).toEqual(["2026-10-12"]);
    expect(monthItems(org, "2026-10", 0).heavyDays).toEqual([]);
  });
  it("подсветка найденного: без учёта регистра, все вхождения, текст не теряется", () => {
    expect(markParts("Купить Хлеб и хлебцы", "хлеб")).toEqual([["Купить ", false], ["Хлеб", true], [" и ", false], ["хлеб", true], ["цы", false]]);
    expect(markParts("текст", "")).toEqual([["текст", false]]);
    expect(markParts("abc", "zz")).toEqual([["abc", false]]);
  });
  it("куда перенести из строки: каждый день один раз", () => {
    const wed = moveTargets(new Date(2026, 9, 14, 15));
    expect(wed.map((x) => x.label)).toEqual(["Сегодня", "Завтра", "В понедельник", "Через неделю"]);
    expect(wed.map((x) => x.key)).toEqual(["2026-10-14", "2026-10-15", "2026-10-19", "2026-10-21"]);
    expect(moveTargets(new Date(2026, 9, 11, 15)).map((x) => x.label)).toEqual(["Сегодня", "Завтра", "Через неделю"]); // воскресенье
    expect(moveTargets(new Date(2026, 9, 12, 15)).map((x) => x.label)).toEqual(["Сегодня", "Завтра", "В понедельник"]); // понедельник
  });
  it("чипы проектов: только открытые дела, цели под своим названием", () => {
    const notes = [todo("1", { project: "работа" }), todo("2", { project: "работа" }), todo("3", { project: "g1" }), todo("4", { project: "дом", done: true })];
    expect(projectCounts(notes, (id) => (id === "g1" ? "Ремонт" : undefined))).toEqual([{ id: "работа", label: "#работа", n: 2 }, { id: "g1", label: "◎ Ремонт", n: 1 }]);
  });
});
