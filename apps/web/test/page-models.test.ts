import { describe, expect, it } from "vitest";
import type { MemoryItem, ModuleInfo } from "../src/api";
import { buildModules, filterMemory, filterModules, impactOf, isArchived, layoutGraph, memoryCounts, moduleMeta, needsOf, shortUptime, statusShares } from "../src/pages/models";

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
    expect(memoryCounts(items)).toEqual({ all: 4, pending: 2, fact: 2, preference: 1, lesson: 1, pinned: 0, archived: 0, active: 2 });
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

describe("module tiles", () => {
  it("known modules get a short name and their own icon; unknown ones fall back safely", () => {
    const m = (name: string, title: string, kind: "builtin" | "manifest" = "builtin") => moduleMeta({ name, title, kind });
    expect(m("brain", "Мозг JUUNIBI")).toMatchObject({ short: "Мозг", icon: "brain" });
    expect(m("approvals", "Подтверждение действий").short.length).toBeLessThanOrEqual(10);
    expect(m("scenes", "Сцены и реплики").icon).toBe("scenes");
    expect(m("future", "Очень длинное название модуля").short).toBe("Очень длинное…");
    expect(m("future", "Короткое").short).toBe("Короткое");
    expect(m("w", "Погода", "manifest").icon).toBe("puzzle");
    expect(m("future", "X").icon).toBe("modules");
  });
  it("every built-in module has a distinct icon (tiles must be told apart at a glance)", () => {
    const icons = ["brain", "memory", "assistant", "approvals", "scenes", "updater"].map((n) => moduleMeta({ name: n, title: n, kind: "builtin" }).icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
  it("statusShares always adds up to 100 and omits empty statuses", () => {
    expect(statusShares({ started: 0, pending: 0, failed: 0, stopped: 0 })).toEqual([]);
    for (const c of [{ started: 4, pending: 1, failed: 0, stopped: 1 }, { started: 1, pending: 1, failed: 1, stopped: 1 }, { started: 7, pending: 0, failed: 0, stopped: 0 }, { started: 1, pending: 2, failed: 0, stopped: 4 }]) {
      const rows = statusShares(c);
      expect(rows.reduce((n, r) => n + r.pct, 0)).toBe(100);
      expect(rows.every((r) => r.count > 0)).toBe(true);
    }
    expect(statusShares({ started: 3, pending: 0, failed: 1, stopped: 0 }).map((r) => r.status)).toEqual(["started", "failed"]);
  });
  it("shortUptime picks the shortest useful unit", () => {
    expect([shortUptime(5), shortUptime(150), shortUptime(7300), shortUptime(200000)]).toEqual(["только что", "2 мин", "2 ч", "2 д"]);
  });
});

describe("memory: pinned and archive", () => {
  const NOW = 1_000_000;
  const mk = (id: string, o: Partial<MemoryItem> = {}): MemoryItem => ({ id, kind: "fact", text: "запись " + id, status: "active", score: 0, createdAt: 1, ...o });
  const items = [mk("a"), mk("b", { pinned: true }), mk("c", { expiresAt: NOW - 1 }), mk("d", { expiresAt: NOW + 1000 }), mk("e", { status: "pending", kind: "lesson" }), mk("f", { pinned: true, expiresAt: NOW - 5 })];
  it("isArchived: only a date in the past", () => {
    expect([isArchived({}, NOW), isArchived({ expiresAt: NOW + 1 }, NOW), isArchived({ expiresAt: NOW }, NOW), isArchived({ expiresAt: NOW - 1 }, NOW)]).toEqual([false, false, true, true]);
  });
  it("counts: archived entries are counted apart and never in the other numbers", () => {
    expect(memoryCounts(items, NOW)).toMatchObject({ all: 4, archived: 2, pinned: 1, pending: 1, active: 3, lesson: 1, fact: 3 });
  });
  it("filter: the main list hides the archive, the archive shows only expired, pinned come first", () => {
    expect(filterMemory(items, "all", "", NOW).map((m) => m.id)).toEqual(["e", "b", "a", "d"]);
    expect(filterMemory(items, "archived", "", NOW).map((m) => m.id).sort()).toEqual(["c", "f"]);
    expect(filterMemory(items, "pinned", "", NOW).map((m) => m.id)).toEqual(["b"]);
    expect(filterMemory(items, "archived", "запись c", NOW).map((m) => m.id)).toEqual(["c"]);
  });
});
