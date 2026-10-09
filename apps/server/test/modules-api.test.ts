import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { ModuleManager } from "../src/module-manager";
import { ManifestStore } from "../src/module-manifest";
import { SceneEngine } from "../src/scenes";

let server: http.Server, base: string, dir: string, mm: ModuleManager;
const root = path.resolve(__dirname, "..", "..", "..");
const call = (p: string, method = "GET", body?: unknown) =>
  fetch(base + p, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-api-"));
  const scenes = new SceneEngine(root, () => undefined);
  await scenes.init();
  const manifests = new ManifestStore(path.join(dir, "man.json"), () => ["scenes", "memory"]);
  mm = new ModuleManager(dir, [
    { name: "memory", title: "Память", deps: [], core: true, description: "m", files: [], probe: () => ({ status: "started", note: "" }) },
    { name: "scenes", title: "Сцены и реплики", deps: [], description: "s", files: [], probe: () => ({ status: "started", note: "" }) },
    { name: "brain", title: "Мозг", deps: ["memory"], description: "b", files: [], probe: () => ({ status: "started", note: "" }) },
  ], path.join(dir, "modules.json"), { manifests: () => manifests.list() });
  await mm.load();
  server = createApp({
    scenes, modules: () => [], configured: {},
    moduleControl: {
      list: () => mm.list(), isActive: n => mm.isActive(n), title: n => mm.list().find(m => m.name === n)?.title ?? n,
      detail: n => mm.detail(n), act: (n, a) => mm.act(n, a as never), promptView: () => mm.promptView(), tools: () => mm.tools(),
      setToolAllowed: (t, a) => mm.setToolAllowed(t, a), setAssistantAccess: (n, a) => mm.setAssistantAccess(n, a), track: (n, w) => mm.track(n, w),
      manifests: { list: () => manifests.list(), preview: i => manifests.preview(i), install: (i, h) => manifests.install(i, h), remove: n => manifests.remove(n), fetch: async () => { throw new Error("нет сети"); } },
    },
  });
  base = await new Promise<string>(r => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
});
afterAll(async () => { server.close(); await mm.flush(); await rm(dir, { recursive: true, force: true }); });

describe("API модулей", () => {
  it("остановленный модуль отказывает в своих маршрутах, запуск возвращает их", async () => {
    expect((await call("/api/juunibi/scenes/next", "POST", {})).status).toBe(200);
    const stopped = await (await call("/api/modules/scenes/stop", "POST", {})).json();
    expect(stopped.status).toBe("stopped");
    const refused = await call("/api/juunibi/scenes/next", "POST", {});
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toContain("Сцены и реплики");
    await call("/api/modules/scenes/start", "POST", {});
    expect((await call("/api/juunibi/scenes/next", "POST", {})).status).toBe(200);
  });
  it("«Мозг» остановлен — его эндпоинты 503, статус зависимых виден в списке", async () => {
    await call("/api/modules/brain/stop", "POST", {});
    expect((await call("/api/brain")).status).toBe(503);
    expect((await call("/api/learning")).status).toBe(503);
    expect((await call("/api/knowledge")).status).toBe(503);
    const list = await (await call("/api/modules")).json();
    expect(list.find((m: { name: string }) => m.name === "brain").status).toBe("stopped");
    await call("/api/modules/brain/start", "POST", {});
  });
  it("ядро — 409; неизвестный модуль — 404; детали и просмотр помощницы", async () => {
    expect((await call("/api/modules/memory/stop", "POST", {})).status).toBe(409);
    expect((await call("/api/modules/ghost/restart", "POST", {})).status).toBe(404);
    expect((await call("/api/modules/ghost")).status).toBe(404);
    const d = await (await call("/api/modules/memory")).json();
    expect(d).toMatchObject({ name: "memory", core: true, description: "m" });
    const view = await (await call("/api/modules/assistant-view")).json();
    expect(JSON.parse(view.json).map((m: { name: string }) => m.name)).toEqual(["memory", "scenes", "brain"]);
    expect(view.chars).toBe(view.json.length);
  });
  it("права: валидация и сохранение", async () => {
    expect((await call("/api/modules/tools/policy", "POST", { tool: "x" })).status).toBe(400);
    expect((await call("/api/modules/tools/policy", "POST", { tool: "search_memory", allowed: false })).status).toBe(200);
    expect(mm.toolAllowed("search_memory")).toBe(false);
    await call("/api/modules/tools/policy", "POST", { tool: "search_memory", allowed: true });
    const acc = await (await call("/api/modules/brain/access", "POST", { allowed: false })).json();
    expect(acc.assistantBlocked).toBe(true);
    await call("/api/modules/brain/access", "POST", { allowed: true });
  });
  it("манифесты: просмотр, установка с суммой, отказ при неверной сумме, удаление", async () => {
    const manifest = { name: "weather", title: "Погода", description: "Описание модуля погоды", version: "1.0.0", permissions: ["read:memory"] };
    const prev = await (await call("/api/modules/manifests/preview", "POST", { manifest })).json();
    expect(prev.executable).toBe(false);
    expect((await call("/api/modules/manifests/install", "POST", { manifest, sha256: "0".repeat(64) })).status).toBe(400);
    expect((await call("/api/modules/manifests/install", "POST", { manifest, sha256: prev.sha256 })).status).toBe(201);
    const list = await (await call("/api/modules")).json();
    expect(list.find((m: { name: string }) => m.name === "weather")).toMatchObject({ kind: "manifest", status: "pending" });
    expect((await call("/api/modules/manifests/preview", "POST", { manifest: { ...manifest, code: "x" } })).status).toBe(400);
    expect((await call("/api/modules/manifests/preview", "POST", { manifest: { ...manifest, name: "scenes" } })).status).toBe(409);
    expect((await call("/api/modules/weather/start", "POST", {})).status).toBe(404);
    expect((await call("/api/modules/manifests/weather", "DELETE")).status).toBe(200);
    expect((await call("/api/modules/manifests/weather", "DELETE")).status).toBe(404);
  });
  it("адрес манифеста вне репозитория отклоняется до обращения к сети", async () => {
    expect((await call("/api/modules/manifests/preview", "POST", { url: "https://evil.com/x.json" })).status).toBeGreaterThanOrEqual(400);
  });
});
