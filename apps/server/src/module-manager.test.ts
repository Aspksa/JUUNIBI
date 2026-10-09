import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModuleManager, moduleOfTool, type ModuleDef } from "./module-manager";

async function setup(over: Partial<Record<string, Partial<ModuleDef>>> = {}, extra = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-mods-"));
  await writeFile(path.join(dir, "a.json"), "12345");
  const def = (name: string, deps: string[], o: Partial<ModuleDef> = {}): ModuleDef => ({
    name, title: name.toUpperCase(), deps, description: "описание " + name, files: ["a.json", "missing.json"],
    probe: () => ({ status: "started", note: "ok" }), ...o, ...(over[name] ?? {}),
  });
  const m = new ModuleManager(dir, [def("memory", [], { core: true }), def("assistant", ["memory"]), def("brain", ["assistant"]), def("scenes", [])], path.join(dir, "modules.json"), extra);
  await m.load();
  return { m, dir, done: () => rm(dir, { recursive: true, force: true }) };
}

describe("ModuleManager", () => {
  it("остановка меняет статус и помечает зависимые как ожидающие", async () => {
    const { m, done } = await setup();
    try {
      await m.act("assistant", "stop");
      const by = Object.fromEntries(m.list().map(x => [x.name, x]));
      expect(by.assistant!.status).toBe("stopped");
      expect(by.brain!.status).toBe("pending");
      expect(by.brain!.note).toContain("assistant");
      expect(m.isActive("assistant")).toBe(false);
      await m.act("assistant", "start");
      expect(m.list().find(x => x.name === "brain")!.status).toBe("started");
    } finally { await done(); }
  });
  it("dependents перечисляет всех зависимых транзитивно", async () => {
    const { m, done } = await setup();
    try { expect(m.dependents("memory").sort()).toEqual(["assistant", "brain"]); expect(m.dependents("scenes")).toEqual([]); }
    finally { await done(); }
  });
  it("ядро нельзя остановить или выключить", async () => {
    const { m, done } = await setup();
    try {
      await expect(m.act("memory", "stop")).rejects.toMatchObject({ status: 409 });
      await expect(m.act("memory", "disable")).rejects.toMatchObject({ status: 409 });
      await expect(m.act("ghost", "stop")).rejects.toMatchObject({ status: 404 });
    } finally { await done(); }
  });
  it("выключение сохраняется и переживает «перезапуск сервера»", async () => {
    const { m, dir, done } = await setup();
    try {
      await m.act("scenes", "disable");
      await m.flush();
      expect(m.list().find(x => x.name === "scenes")).toMatchObject({ status: "stopped", enabled: false, running: false });
      const again = new ModuleManager(dir, [{ name: "scenes", title: "S", deps: [], description: "", files: [], probe: () => ({ status: "started", note: "" }) }], path.join(dir, "modules.json"));
      await again.load();
      expect(again.isActive("scenes")).toBe(false);
      await again.act("scenes", "enable");
      expect(again.isActive("scenes")).toBe(true);
    } finally { await done(); }
  });
  it("сбой запуска даёт статус failed с причиной и журналом, затем перезапуск лечит", async () => {
    let broken = true;
    const { m, done } = await setup({ scenes: { start: async () => { if (broken) throw new Error("каталог повреждён"); } } });
    try {
      await m.act("scenes", "restart");
      const item = m.list().find(x => x.name === "scenes")!;
      expect(item.status).toBe("failed");
      expect(item.error).toBe("каталог повреждён");
      const d = await m.detail("scenes");
      expect(d.health!.errors24h).toBe(1);
      expect(d.log.some(l => l.level === "error" && l.text.includes("каталог"))).toBe(true);
      broken = false;
      await m.act("scenes", "restart");
      expect(m.list().find(x => x.name === "scenes")!.status).toBe("started");
    } finally { await done(); }
  });
  it("не останавливает занятый модуль", async () => {
    const { m, done } = await setup({ scenes: { busy: () => "Идёт обновление" } });
    try { await expect(m.act("scenes", "stop")).rejects.toMatchObject({ status: 409, message: "Идёт обновление" }); expect(m.isActive("scenes")).toBe(true); }
    finally { await done(); }
  });
  it("detail: размеры файлов, время ответа, последний успех", async () => {
    let t = 1_000_000;
    const { m, done } = await setup({}, { now: () => t });
    try {
      await m.track("assistant", async () => { t += 250; return 1; });
      await m.track("assistant", async () => { t += 350; return 1; });
      await expect(m.track("assistant", async () => { throw new Error("сеть"); })).rejects.toThrow("сеть");
      const d = await m.detail("assistant");
      expect(d.files).toEqual([{ path: "a.json", size: 5 }, { path: "missing.json", size: null }]);
      expect(d.health).toMatchObject({ avgMs: 300, lastMs: 350, errors24h: 1, lastError: "сеть", calls: 3 });
      expect(d.health!.lastOkAt).not.toBeNull();
      expect(d.description).toContain("assistant");
    } finally { await done(); }
  });
  it("ошибки старше суток не считаются", async () => {
    let t = 1_000_000_000;
    const { m, done } = await setup({}, { now: () => t });
    try {
      m.fail("scenes", "старая"); t += 25 * 3600_000; m.fail("scenes", "новая");
      expect((await m.detail("scenes")).health!.errors24h).toBe(1);
    } finally { await done(); }
  });
  it("в списке есть краткая сводка здоровья для плитки", async () => {
    let t = 5_000_000;
    const { m, done } = await setup({}, { now: () => t });
    try {
      t += 125_000; m.fail("scenes", "сбой"); await m.track("scenes", async () => { t += 40; });
      const item = m.list().find(x => x.name === "scenes")!;
      expect(item).toMatchObject({ uptimeSec: 125, errors24h: 1, lastMs: 40 });
      await m.act("scenes", "stop");
      expect(m.list().find(x => x.name === "scenes")!.uptimeSec).toBe(0);
    } finally { await done(); }
  });
  it("promptView — ровно подмножество полей, которое видит помощница", async () => {
    const { m, done } = await setup();
    try { expect(Object.keys(m.promptView()[0]!).sort()).toEqual(["deps", "name", "note", "status", "title"]); }
    finally { await done(); }
  });
});

describe("права помощницы", () => {
  it("владелец сужает права: инструмент, модуль и остановка закрывают инструменты", async () => {
    const { m, done } = await setup();
    try {
      expect(m.toolAllowed("search_memory")).toBe(true);
      await m.setToolAllowed("search_memory", false);
      expect(m.toolAllowed("search_memory")).toBe(false);
      await m.setToolAllowed("search_memory", true);
      await m.setAssistantAccess("brain", false);
      expect(m.toolAllowed("brain_create_plan")).toBe(false);
      await m.setAssistantAccess("brain", true);
      await m.act("brain", "stop");
      expect(m.toolAllowed("brain_get_plans")).toBe(false);
      expect(m.toolAllowed("list_modules")).toBe(true);
      await expect(m.setToolAllowed("../x", false)).rejects.toMatchObject({ status: 400 });
    } finally { await done(); }
  });
  it("tools() считает вызовы за сутки", async () => {
    const now = Date.now();
    const { m, done } = await setup({}, {
      tools: () => [{ name: "list_modules", risk: "read" as const, description: "d" }],
      outcomes: () => [
        { tool: "list_modules", status: "ok" as const, at: new Date(now - 1000).toISOString() },
        { tool: "list_modules", status: "error" as const, at: new Date(now - 2000).toISOString() },
        { tool: "list_modules", status: "ok" as const, at: new Date(now - 3 * 86_400_000).toISOString() },
      ],
    });
    try { expect(m.tools()[0]).toMatchObject({ module: "assistant", calls24h: 2, errors24h: 1, allowed: true }); }
    finally { await done(); }
  });
  it("модуль инструмента определяется по имени", () => {
    expect([moduleOfTool("brain_run_safe_plan"), moduleOfTool("remember"), moduleOfTool("list_modules"), moduleOfTool("x")]).toEqual(["brain", "memory", "assistant", "assistant"]);
  });
  it("запись настроек не падает при сбое и восстанавливается", async () => {
    const { m, dir, done } = await setup();
    try {
      await writeFile(path.join(dir, "blocked"), "x");
      const bad = new ModuleManager(dir, [], path.join(dir, "blocked", "m.json"));
      await bad.load();
      await expect(bad.setToolAllowed("t", false)).rejects.toThrow();
      expect((await readFile(path.join(dir, "a.json"), "utf8"))).toBe("12345"); // чужие файлы не тронуты
      expect(m.isActive("scenes")).toBe(true);
    } finally { await done(); }
  });
});
