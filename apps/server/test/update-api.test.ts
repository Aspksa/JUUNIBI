import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { ProjectUpdater } from "../src/updater";

let server: http.Server, base: string, dir: string, updater: ProjectUpdater;
let supervised = true; const restart = vi.fn(() => supervised);
const call = (p: string, method = "GET", body?: unknown) => fetch(base + p, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ready = async (on: boolean) => {
  const f = path.join(dir, ".updates", "ready.json");
  if (on) { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, "{}"); } else await rm(f, { force: true });
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-uapi-"));
  updater = new ProjectUpdater(dir, { retryDelaysMs: [0] });
  server = createApp({ updater, restart, activity: () => (busyWork ? ["выполняются планы Мозга: 1"] : []), modules: () => [], configured: {} });
  base = await new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
});
let busyWork = false;
afterAll(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

describe("маршруты обновления", () => {
  it("статус содержит настройки, причину блокировки и список того, что прервёт перезапуск", async () => {
    const s = await (await call("/api/update/status")).json();
    expect(s).toMatchObject({ phase: "idle", config: { channel: "fresh", autoCheck: "hourly" }, rollbackPending: false, blocked: null, activity: [] });
    expect(s.checks.map((c: { id: string }) => c.id)).toEqual(["install", "typecheck", "test", "build"]);
  });
  it("настройки: частичное обновление, проверка значений", async () => {
    const r = await (await call("/api/update/settings", "POST", { autoCheck: "daily" })).json();
    expect(r.config).toEqual({ channel: "fresh", autoCheck: "daily" });
    expect((await call("/api/update/settings", "POST", { channel: "nightly" })).status).toBe(400);
    expect((await call("/api/update/settings", "POST", { autoCheck: "hourly" })).status).toBe(200);
  });
  it("отмена без подготовки — 409", async () => {
    const r = await call("/api/update/cancel", "POST", {});
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Нечего отменять/);
  });
  it("«установить сейчас» требует готовое обновление или откат", async () => {
    const r = await call("/api/update/install-now", "POST", {});
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Нет подготовленного/);
    expect(restart).not.toHaveBeenCalled();
  });
  it("с готовым обновлением перезапуск сначала предупреждает о текущей работе и идёт только после подтверждения", async () => {
    await ready(true);
    (updater as unknown as { state: { phase: string } }).state.phase = "ready";
    busyWork = true;
    const warn = await call("/api/update/install-now", "POST", {});
    expect(warn.status).toBe(409);
    expect((await warn.json()).warnings).toEqual(["выполняются планы Мозга: 1"]);
    expect(restart).not.toHaveBeenCalled();
    const ok = await call("/api/update/install-now", "POST", { force: true });
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ restarting: true });
    expect(restart).toHaveBeenCalledTimes(1);
    busyWork = false;
    expect((await call("/api/update/install-now", "POST", {})).status).toBe(202); // nothing to warn about
  });
  it("без лаунчера перезапуск не обещается", async () => {
    supervised = false;
    const r = await call("/api/update/install-now", "POST", {});
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/без лаунчера/);
    supervised = true;
    (updater as unknown as { state: { phase: string } }).state.phase = "idle";
    await ready(false);
  });
  it("история и откат: запрос записывается, отмена убирает его", async () => {
    expect(await (await call("/api/update/history")).json()).toEqual({ items: [], canRollback: null, rollbackPending: false });
    expect((await call("/api/update/rollback", "POST", {})).status).toBe(409);
    const folder = path.join(dir, ".updates");
    await mkdir(path.join(folder, "backups", "b1"), { recursive: true });
    await writeFile(path.join(folder, "backups", "b1", ".meta.json"), "{}");
    await writeFile(path.join(folder, "history.jsonl"), JSON.stringify({ id: "1", at: "2026-10-09T00:00:00Z", kind: "install", from: "a", to: "b", backup: "b1" }) + "\n");
    const h = await (await call("/api/update/history")).json();
    expect(h.canRollback.backup).toBe("b1");
    const req = await (await call("/api/update/rollback", "POST", {})).json();
    expect(req.rollbackPending).toBe(true);
    expect(JSON.parse(await readFile(path.join(folder, "rollback-request.json"), "utf8")).backup).toBe("b1");
    // a pending rollback can be installed right away through the launcher
    expect((await call("/api/update/install-now", "POST", {})).status).toBe(202);
    expect((await (await call("/api/update/rollback", "POST", { cancel: true })).json()).rollbackPending).toBe(false);
  });
});
