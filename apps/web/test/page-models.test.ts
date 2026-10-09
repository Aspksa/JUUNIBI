import { describe, expect, it } from "vitest";
import type { MemoryItem, ModuleInfo } from "../src/api";
import { buildModules, filterMemory, filterModules, impactOf, layoutGraph, memoryCounts, needsOf } from "../src/pages/models";

const mod = (name: string, deps: string[] = [], status = "started"): ModuleInfo => ({ name, deps, status });
describe("buildModules", () => {
  it("puts dependencies first and records depth", () => {
    const { items } = buildModules([mod("approvals", ["assistant"]), mod("assistant", ["memory"]), mod("memory"), mod("scenes")]);
    expect(items.map((m) => [m.name, m.depth])).toEqual([["memory", 0], ["scenes", 0], ["assistant", 1], ["approvals", 2]]);
  });
  it("counts statuses and treats unknown status as pending", () => {
    const { counts } = buildModules([mod("a"), mod("b", [], "pending"), mod("c", [], "failed"), mod("d", [], "weird")]);
    expect(counts).toEqual({ started: 1, pending: 2, failed: 1, stopped: 0 });
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
  it("empty list", () => { expect(buildModules([])).toEqual({ items: [], counts: { started: 0, pending: 0, failed: 0, stopped: 0 } }); });
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

describe("module search, impact and graph", () => {
  const items = buildModules([mod("memory"), { ...mod("assistant", ["memory"]), title: "Помощница", note: "Модель Cloud.ru" }, mod("brain", ["assistant", "memory"]), mod("scenes", [], "stopped"), mod("approvals", ["assistant"], "failed")]).items;
  it("filters by text in name, title, note and deps, and by status", () => {
    expect(filterModules(items, "помощ", "all").map((m) => m.name)).toEqual(["assistant"]);
    expect(filterModules(items, "cloud", "all").map((m) => m.name)).toEqual(["assistant"]);
    expect(filterModules(items, "memory", "all").map((m) => m.name).sort()).toEqual(["assistant", "brain", "memory"]); // by dependency too
    expect(filterModules(items, "", "stopped").map((m) => m.name)).toEqual(["scenes"]);
    expect(filterModules(items, "  ", "all")).toHaveLength(5);
    expect(filterModules(items, "zzz", "all")).toEqual([]);
  });
  it("impactOf lists everything that breaks transitively; needsOf lists what a module needs", () => {
    expect(impactOf(items, "memory").sort()).toEqual(["approvals", "assistant", "brain"]);
    expect(impactOf(items, "scenes")).toEqual([]);
    expect(needsOf(items, "approvals").sort()).toEqual(["assistant", "memory"]);
  });
  it("impactOf and needsOf survive cycles", () => {
    const c = buildModules([mod("x", ["y"]), mod("y", ["x"])]).items;
    expect(impactOf(c, "x")).toEqual(["y"]);
    expect(needsOf(c, "x")).toEqual(["y"]);
  });
  it("layoutGraph puts depths in columns, skips unknown deps and sizes the canvas", () => {
    const g = layoutGraph(buildModules([mod("a"), mod("b"), mod("c", ["a", "ghost"])]).items);
    expect(g.edges).toEqual([{ from: "a", to: "c" }]);
    const by = Object.fromEntries(g.nodes.map((n) => [n.name, n]));
    expect(by.a!.x).toBe(by.b!.x);
    expect(by.c!.x).toBeGreaterThan(by.a!.x);
    expect(by.b!.y).toBeGreaterThan(by.a!.y);
    expect(g.width).toBeGreaterThan(by.c!.x + by.c!.w - 1);
    expect(g.height).toBeGreaterThan(by.b!.y + by.b!.h - 1);
    expect(layoutGraph([])).toMatchObject({ nodes: [], edges: [], width: 32, height: 32 });
  });
});
