import { describe, expect, it } from "vitest";
import type { MemoryItem, ModuleInfo } from "../src/api";
import { buildModules, filterMemory, memoryCounts } from "../src/pages/models";

const mod = (name: string, deps: string[] = [], status = "started"): ModuleInfo => ({ name, deps, status });
describe("buildModules", () => {
  it("puts dependencies first and records depth", () => {
    const { items } = buildModules([mod("approvals", ["assistant"]), mod("assistant", ["memory"]), mod("memory"), mod("scenes")]);
    expect(items.map((m) => [m.name, m.depth])).toEqual([["memory", 0], ["scenes", 0], ["assistant", 1], ["approvals", 2]]);
  });
  it("counts statuses and treats unknown status as pending", () => {
    const { counts } = buildModules([mod("a"), mod("b", [], "pending"), mod("c", [], "failed"), mod("d", [], "weird")]);
    expect(counts).toEqual({ started: 1, pending: 2, failed: 1 });
  });
  it("survives unknown dependencies and cycles; falls back to the name as title", () => {
    const { items } = buildModules([mod("a", ["ghost"]), mod("x", ["y"]), mod("y", ["x"])]);
    expect(items).toHaveLength(3);
    expect(items.find((m) => m.name === "a")!.depth).toBe(0);
    expect(items.find((m) => m.name === "a")!.title).toBe("a");
  });
  it("keeps the server order inside one depth", () => {
    expect(buildModules([mod("z"), mod("a"), mod("m")]).items.map((m) => m.name)).toEqual(["z", "a", "m"]);
  });
  it("empty list", () => { expect(buildModules([])).toEqual({ items: [], counts: { started: 0, pending: 0, failed: 0 } }); });
});

const m = (id: string, text: string, kind = "fact", status: "active" | "pending" = "active", createdAt = 1): MemoryItem => ({ id, text, kind, status, score: 0, createdAt });
describe("memory helpers", () => {
  const items = [m("1", "Люблю чай", "preference", "active", 10), m("2", "Живу в Москве", "fact", "active", 30), m("3", "Отвечать кратко", "lesson", "pending", 20), m("4", "Кофе без сахара", "fact", "pending", 40)];
  it("counts by status and kind", () => {
    expect(memoryCounts(items)).toEqual({ all: 4, pending: 2, fact: 2, preference: 1, lesson: 1, active: 2 });
  });
  it("pending first, then newest first", () => {
    expect(filterMemory(items, "all", "").map((x) => x.id)).toEqual(["4", "3", "2", "1"]);
  });
  it("filters by kind and by pending", () => {
    expect(filterMemory(items, "fact", "").map((x) => x.id)).toEqual(["4", "2"]);
    expect(filterMemory(items, "pending", "").map((x) => x.id)).toEqual(["4", "3"]);
  });
  it("searches text case-insensitively and combines with the filter", () => {
    expect(filterMemory(items, "all", "КОФЕ").map((x) => x.id)).toEqual(["4"]);
    expect(filterMemory(items, "preference", "кофе")).toEqual([]);
  });
  it("items without createdAt do not break sorting", () => {
    expect(filterMemory([{ ...m("a", "x"), createdAt: undefined }, m("b", "y", "fact", "active", 5)], "all", "").map((x) => x.id)).toEqual(["b", "a"]);
  });
});
