import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
