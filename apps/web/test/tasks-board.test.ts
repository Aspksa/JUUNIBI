import { describe, expect, it } from "vitest";
import type { Note } from "../src/api";
import { boardColumns, boardFilter, boardLanes, columnOf, daysWord, placeAt, sideColumn, statusDays, todoBuckets } from "../src/pages/tasks-model";

// Пятница, 9 октября 2026, 14:00 по местному времени
const now = new Date(2026, 9, 9, 14, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const todo = (id: string, o: Partial<Note> = {}): Note => ({ id, kind: "todo", text: id, done: false, createdAt: "2026-10-01T10:00:00.000Z", ...o });
const ids = (xs: Note[]) => xs.map((n) => n.id);

describe("доска «Дел»", () => {
  it("колонка карточки и соседние колонки", () => {
    expect(columnOf(todo("a"))).toBe("todo");
    expect(columnOf(todo("a", { status: "waiting" }))).toBe("waiting");
    expect(columnOf(todo("a", { status: "doing", done: true }))).toBe("done");
    expect(sideColumn("todo", -1)).toBeNull();
    expect(sideColumn("todo", 1)).toBe("doing");
    expect(sideColumn("waiting", 1)).toBe("done");
  });
  it("перетащенные карточки стоят в своём порядке, остальные — по важности и сроку", () => {
    const cols = boardColumns([todo("late", { dueAt: at(20, 10) }), todo("hi", { priority: "high" }), todo("r1", { rank: 1 }), todo("r0", { rank: 0 })], now);
    expect(ids(cols.todo)).toEqual(["r0", "r1", "hi", "late"]);
  });
  it("«Надо сделать» по группам: просрочено, сегодня, неделя, позже", () => {
    const list = [todo("old", { dueAt: at(8, 10) }), todo("now", { dueAt: at(9, 18) }), todo("past", { dueAt: at(9, 9) }), todo("day", { dueAt: at(9, 23, 59) }),
      todo("sun", { dueAt: at(11, 12) }), todo("next", { dueAt: at(13, 12) }), todo("none")];
    expect(todoBuckets(list, now).map((g) => [g.key, ids(g.notes)])).toEqual([
      ["late", ["old", "past"]], ["today", ["now", "day"]], ["week", ["sun"]], ["later", ["next", "none"]]]);
  });
  it("фильтры: важные и до конца недели (начатые и ждущие остаются)", () => {
    const list = [todo("hi", { priority: "high", dueAt: at(20, 10) }), todo("fri", { dueAt: at(10, 10) }), todo("far", { dueAt: at(20, 10) }), todo("wait", { status: "waiting" }), todo("none")];
    expect(ids(boardFilter(list, { important: true }, now))).toEqual(["hi"]);
    expect(ids(boardFilter(list, { week: true }, now))).toEqual(["fri", "wait"]);
    expect(ids(boardFilter(list, {}, now))).toHaveLength(5);
  });
  it("сколько дней ждёте, по-русски", () => {
    expect(statusDays({ statusAt: at(6, 23) }, now)).toBe(3);
    expect(statusDays({ statusAt: at(9, 9) }, now)).toBe(0);
    expect(statusDays({}, now)).toBeNull();
    expect([1, 2, 5, 11, 21, 22, 25, 112].map(daysWord)).toEqual(["1 день", "2 дня", "5 дней", "11 дней", "21 день", "22 дня", "25 дней", "112 дней"]);
  });
  it("строки доски: проекты (без проекта в конце) и работа/личное", () => {
    const list = [todo("a", { project: "дом" }), todo("b"), todo("c", { project: "Cloud" }), todo("d", { project: "Cloud" }), todo("g", { project: "m1" })];
    const lanes = boardLanes(list, "project", [{ name: "cloud", color: "blue" }], (id) => (id === "m1" ? "Цель" : undefined));
    expect(lanes.map((l) => [l.key, l.label, ids(l.notes)])).toEqual([["Cloud", "#Cloud", ["c", "d"]], ["дом", "#дом", ["a"]], ["m1", "◎ Цель", ["g"]], ["", "Без проекта", ["b"]]]);
    expect(lanes[0]!.color).toBe("blue");
    expect(boardLanes([todo("w", { area: "work" }), todo("p")], "area").map((l) => ids(l.notes))).toEqual([["w"], ["p"]]);
    expect(boardLanes(list, "none")).toHaveLength(1);
  });
  it("место карточки в колонке", () => {
    expect(placeAt(["a", "b", "c"], "x", 1)).toEqual(["a", "x", "b", "c"]);
    expect(placeAt(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
    expect(placeAt(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(placeAt(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });
});
