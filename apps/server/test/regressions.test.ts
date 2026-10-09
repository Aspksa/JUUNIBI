import { afterEach, describe, expect, it, vi } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { ProjectUpdater } from "../src/updater";
import { KnowledgeLedger } from "../src/knowledge-ledger";
import { SceneEngine } from "../src/scenes";
import { checkPublicEvidence } from "../src/public-evidence";

const root = path.resolve(__dirname, "..", "..", "..");
const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; vi.restoreAllMocks(); });
const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

describe("обновление: гонка запусков", () => {
  it("второй start() не падает необработанным reject, а isBusy() сразу true", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-race-"));
    try {
      globalThis.fetch = vi.fn(async () => new Response("{}", { status: 403 }));
      const u = new ProjectUpdater(dir);
      const first = u.start();
      expect(u.isBusy()).toBe(true);
      expect(u.status().phase).toBe("downloading");
      await expect(u.start()).rejects.toThrow(/уже выполняется/);
      await first;
      expect(u.isBusy()).toBe(false);
      expect(u.status().phase).toBe("error");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("busy не залипает, если подготовка упала до основного блока", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-race-"));
    try {
      await writeFile(path.join(dir, ".updates"), "файл вместо папки"); // mkdir(.updates) упадёт
      const u = new ProjectUpdater(dir);
      await u.start();
      expect(u.isBusy()).toBe(false);
      expect(u.status().phase).toBe("error");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("HTTP: параллельные запросы дают 202 и 409, сервер жив", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-race-"));
    globalThis.fetch = Object.assign(vi.fn(async () => new Response("{}", { status: 403 })), {});
    const real = oldFetch;
    const server = createApp({ updater: new ProjectUpdater(dir), modules: () => [], configured: {} });
    const port = await listen(server);
    try {
      const codes = await Promise.all([1, 2, 3].map(() => real(`http://127.0.0.1:${port}/api/update/download`, { method: "POST" }).then((r) => r.status)));
      expect(codes.filter((c) => c === 202)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(2);
      expect((await real(`http://127.0.0.1:${port}/api/status`)).status).toBe(200);
    } finally { server.close(); await new Promise((r) => setTimeout(r, 50)); await rm(dir, { recursive: true, force: true }); }
  });
});

describe("HTTP-границы", () => {
  it("битый %-адрес — 400, а не 500", async () => {
    const server = createApp({ modules: () => [], configured: {}, staticDir: root });
    const port = await listen(server);
    try {
      expect((await oldFetch(`http://127.0.0.1:${port}/%E0%A4%A`)).status).toBe(400);
    } finally { server.close(); }
  });
  it("ошибки проверки источника — 400, недоступный источник — 502", async () => {
    await expect(checkPublicEvidence("evil", "", "x".repeat(40))).rejects.toMatchObject({ status: 400 });
    await expect(checkPublicEvidence("nasa", "../x", "x".repeat(40))).rejects.toMatchObject({ status: 400 });
    await expect(checkPublicEvidence("nasa", "", "короткая")).rejects.toMatchObject({ status: 400 });
    const down = vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    await expect(checkPublicEvidence("nasa", "", "x".repeat(40), down)).rejects.toMatchObject({ status: 502 });
  });
});

describe("журнал знаний: сбой записи не отравляет цепочку", () => {
  it("после неудачной записи следующая успешна, процесс не падает", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-ledger-"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const file = path.join(dir, "sub", "ledger.json");
      await writeFile(path.join(dir, "sub"), "файл вместо папки"); // mkdir упадёт
      const ledger = new KnowledgeLedger(file);
      ledger.addVerified({ topic: "математика", claim: "2 × 2 = 4", source: "тест", evidence: "deterministic-test" });
      await expect(ledger.flush()).rejects.toThrow();
      await rm(path.join(dir, "sub"), { force: true });
      ledger.addVerified({ topic: "математика", claim: "3 × 3 = 9", source: "тест", evidence: "deterministic-test" });
      await expect(ledger.flush()).resolves.toBeUndefined();
      const again = new KnowledgeLedger(file);
      await again.load();
      expect(again.list()).toHaveLength(2);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off("unhandledRejection", unhandled); await rm(dir, { recursive: true, force: true }); }
  });
});

describe("сцены: ответ модели в ```json", () => {
  it("снимает обёртку и принимает новую сцену", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-scenes-"));
    try {
      await mkdir(path.join(dir, "apps", "server"), { recursive: true });
      const { cp } = await import("node:fs/promises");
      await cp(path.join(root, "apps", "server", "assets"), path.join(dir, "apps", "server", "assets"), { recursive: true });
      const text = "Хвосты медленно разворачиваются веером, и лисица, прищурившись, прислушивается к далёкому звону колокольчиков в ночном саду.";
      const llm = { chat: async () => ({ content: "```json\n" + JSON.stringify({ text, category: "тишина", emotion: "calm", duration_seconds: 5 }) + "\n```", toolCalls: [] }) };
      const engine = new SceneEngine(dir, () => llm);
      await engine.init();
      const s = engine as unknown as { state: { used: string[] } };
      s.state.used = (engine as unknown as { actions: { id: string }[] }).actions.map((a) => a.id); // все использованы → генерация
      const r = await engine.next();
      expect(r.action.text).toBe(text);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
