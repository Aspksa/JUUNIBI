import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectUpdater } from "../src/updater";

const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; vi.restoreAllMocks(); });
describe("Обновление проекта", () => {
  it("показывает версию и описание на русском", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-update-"));
    try {
      globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
        sha: "a".repeat(40), commit: { message: "Fix launcher", committer: { date: "2026-10-08T00:00:00Z" } },
      }), { status: 200 }));
      const updater = new ProjectUpdater(root);
      const status = await updater.check();
      expect(status.latest?.version).toBe("aaaaaaaa");
      expect(status.latest?.description).toContain("Обновление проекта");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("не устанавливает непроверенный файл", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-update-"));
    try {
      globalThis.fetch = vi.fn(async (url) => {
        const u = String(url);
        if (u.endsWith("/commits/main")) return new Response(JSON.stringify({
          sha: "a".repeat(40), commit: { message: "Update" },
        }));
        if (u.includes("/git/trees/")) return new Response(JSON.stringify({
          truncated: false, tree: [{ type: "blob", path: "package.json", size: 3, sha: "b".repeat(40) }],
        }));
        return new Response("bad");
      });
      const updater = new ProjectUpdater(root);
      await updater.start();
      expect(updater.status().phase).toBe("error");
      expect(updater.status().error).toMatch(/целостности/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("предлагает к удалению только файлы, установленные прошлым релизом и исчезнувшие из нового", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-update-"));
    try {
      await mkdir(path.join(root, ".updates"), { recursive: true });
      await mkdir(path.join(root, "apps"), { recursive: true });
      await writeFile(path.join(root, "apps", "dropped.txt"), "x");
      await writeFile(path.join(root, "apps", "user-own.txt"), "y"); // not installed by us
      await writeFile(path.join(root, ".updates", "installed.json"), JSON.stringify({ sha: "a".repeat(40), paths: ["apps/dropped.txt", "apps/kept.txt", "apps/gone.txt", "../evil", ".env"] }));
      const u = new ProjectUpdater(root) as unknown as { findRemovals(e: { path: string }[]): Promise<string[]> };
      expect(await u.findRemovals([{ path: "apps/kept.txt" }])).toEqual(["apps/dropped.txt"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("без прошлого релиза ничего не предлагает удалять", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-update-"));
    try {
      const u = new ProjectUpdater(root) as unknown as { findRemovals(e: { path: string }[]): Promise<string[]> };
      expect(await u.findRemovals([])).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("подтверждение удаления требует подготовленного обновления и привязано к его sha", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-update-"));
    try {
      await mkdir(path.join(root, ".updates"), { recursive: true });
      const u = new ProjectUpdater(root);
      await expect(u.confirmRemovals()).rejects.toThrow(/подготовленного/);
      (u as unknown as { state: { phase: string } }).state.phase = "ready";
      await writeFile(path.join(root, ".updates", "ready.json"), JSON.stringify({ sha: "b".repeat(40), files: [], removals: [] }));
      await expect(u.confirmRemovals()).rejects.toThrow(/Нечего/);
      await writeFile(path.join(root, ".updates", "ready.json"), JSON.stringify({ sha: "b".repeat(40), files: [], removals: ["apps/dropped.txt"] }));
      expect((await u.confirmRemovals()).removalsConfirmed).toBe(true);
      expect(JSON.parse(await readFile(path.join(root, ".updates", "removals-confirmed.json"), "utf8"))).toEqual({ sha: "b".repeat(40), paths: ["apps/dropped.txt"] });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
