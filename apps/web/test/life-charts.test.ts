import { describe, expect, it } from "vitest";
import { linePoints, safeColor, splitParts } from "../src/pages/life-charts";

describe("мини-графики «Жизни проекта»", () => {
  it("линия занимает всю ширину, ноль внизу, максимум у верха", () => {
    const p = linePoints([0, 5, 10]);
    expect(p[0]).toEqual([0, 32]);
    expect(p[2]).toEqual([100, 2]);
    expect(p[1]![1]).toBe(17);
  });
  it("одно значение и одинаковые значения — ровная линия без деления на ноль", () => {
    expect(linePoints([7])).toHaveLength(2);
    for (const [, y] of linePoints([3, 3, 3])) expect(Number.isFinite(y)).toBe(true);
    expect(linePoints([])).toEqual([]);
  });
  it("доли полосы считаются в процентах, пустые части пропускаются", () => {
    expect(splitParts([3, 1, 0], ["a", "b", "c"])).toEqual([{ label: "a", value: 3, pct: 75 }, { label: "b", value: 1, pct: 25 }]);
    expect(splitParts([0, 0])).toEqual([]);
  });
  it("в стиль попадают только цвета вида #abc и #aabbcc", () => {
    expect(safeColor("#3C9")).toBe("#3C9");
    expect(safeColor("#f0a030")).toBe("#f0a030");
    expect(safeColor("red;background:url(x)")).toBeNull();
    expect(safeColor("#12345")).toBeNull();
  });
});
