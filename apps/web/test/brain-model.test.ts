import { describe, expect, it } from "vitest";
import type { BrainPlan, MemoryItem } from "../src/api";
import { TILE_ORDER, buildBrainTiles, isTileId, plural, type BrainData } from "../src/pages/brain-model";

const mem = (status: "active" | "pending"): MemoryItem => ({ id: Math.random().toString(), kind: "fact", text: "x", status, score: 0 });
const plan = (status: BrainPlan["status"]): BrainPlan => ({ id: "p", goal: "g", createdAt: "", status, steps: [] });
const full: BrainData = { memory: [mem("active"), mem("active"), mem("pending")], plans: [plan("running"), plan("planned")], learning: { enabled: true, used: 3, limit: 50 }, knowledge: 4, graph: { nodes: 5, edges: 7 }, gaps: 2 };
const by = (d: BrainData) => Object.fromEntries(buildBrainTiles(d).map((t) => [t.id, t]));

describe("плитки «Мозга»", () => {
  it("есть все шесть плиток в заданном порядке, и память — первая", () => {
    expect(buildBrainTiles(full).map((t) => t.id)).toEqual(TILE_ORDER);
    expect(TILE_ORDER[0]).toBe("memory");
  });
  it("память: активные записи в значении, ожидающие — в значке и тревожном цвете", () => {
    expect(by(full).memory).toMatchObject({ value: "2", tone: "warn", badge: "1 ждут" });
    expect(by({ ...full, memory: [mem("active")] }).memory).toMatchObject({ value: "1", tone: "ok" });
    expect(by({ ...full, memory: [mem("active")] }).memory!.badge).toBeUndefined();
  });
  it("планы, обучение, знания, связи и пробелы показывают свои числа", () => {
    const t = by(full);
    expect(t.plans).toMatchObject({ value: "2", sub: "1 в работе", tone: "ok" });
    expect(t.learning).toMatchObject({ value: "3/50", tone: "ok" });
    expect(t.knowledge!.value).toBe("4");
    expect(t.graph).toMatchObject({ value: "7", sub: "5 узлов в графе" });
    expect(t.gaps).toMatchObject({ value: "2", tone: "warn" });
  });
  it("приостановленное обучение и пустые списки выглядят спокойно", () => {
    const t = by({ ...full, learning: { enabled: false, used: 0, limit: 50 }, plans: [], gaps: 0 });
    expect(t.learning).toMatchObject({ sub: "приостановлено", tone: "off" });
    expect(t.plans).toMatchObject({ value: "0", sub: "пока нет", tone: "off" });
    expect(t.gaps).toMatchObject({ sub: "пробелов нет", tone: "ok" });
  });
  it("если модуль «Мозг» недоступен, его плитки серые с прочерком, а память работает", () => {
    const t = by({ memory: [mem("active")], plans: null, learning: null, knowledge: null, graph: null, gaps: null });
    for (const id of ["plans", "learning", "knowledge", "graph", "gaps"] as const) expect(t[id]).toMatchObject({ value: "—", sub: "недоступно", tone: "off" });
    expect(t.memory).toMatchObject({ value: "1", tone: "ok" });
  });
  it("склонение", () => {
    const f: [string, string, string] = ["узел", "узла", "узлов"];
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => plural(n, f))).toEqual(["узел", "узла", "узла", "узлов", "узлов", "узлов", "узлов", "узел", "узла", "узлов", "узел", "узлов"]);
  });
  it("isTileId принимает только известные плитки", () => {
    expect(isTileId("memory")).toBe(true);
    expect([isTileId("x"), isTileId(undefined), isTileId(5)]).toEqual([false, false, false]);
  });
});
