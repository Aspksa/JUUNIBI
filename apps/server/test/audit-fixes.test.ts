import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProjectUpdater, requireMarker } from "../src/updater";
import { AssistantSettingsStore, defaultSettings, validateSettings } from "../src/assistant-settings";

const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; vi.restoreAllMocks(); });
const tmp = () => mkdtemp(path.join(os.tmpdir(), "juunibi-audit-"));
const gitHash = (b: Buffer) => createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
const SHA = "c".repeat(40);

describe("доступ к файлам", () => {
  it("смена папки выключает запись, если её не разрешили для новой папки", async () => {
    const [a, b] = [await tmp(), await tmp()];
    try {
      const base = await validateSettings({ files: { root: a, allowWrite: true } }, defaultSettings({}));
      expect(base.files.allowWrite).toBe(true);
      const moved = await validateSettings({ files: { root: b } }, base);
      expect(moved.files.allowWrite).toBe(false);
      // the same folder keeps its permission; an explicit choice is respected
      expect((await validateSettings({ files: { root: a } }, base)).files.allowWrite).toBe(true);
      expect((await validateSettings({ files: { root: b, allowWrite: true } }, base)).files.allowWrite).toBe(true);
    } finally { await rm(a, { recursive: true, force: true }); await rm(b, { recursive: true, force: true }); }
  });
});

describe("запасная модель", () => {
  it("не может совпадать с основной", async () => {
    await expect(validateSettings({ chat: { model: "a/b", fallbackModel: "a/b" } }, defaultSettings({}))).rejects.toThrow(/совпадает/);
    expect(defaultSettings({ CLOUDRU_MODEL: "a/b", CLOUDRU_FALLBACK_MODEL: "a/b" }).chat.fallbackModel).toBe("");
  });
  it("старый файл с такой парой загружается, запасная просто сбрасывается", async () => {
    const dir = await tmp();
    try {
      const file = path.join(dir, "s.json");
      await writeFile(file, JSON.stringify({ chat: { model: "a/b", fallbackModel: "a/b", reasoning: true }, web: true }));
      const store = new AssistantSettingsStore(file, {});
      await store.load();
      expect(store.get().chat).toEqual({ model: "a/b", fallbackModel: "", reasoning: true });
      expect(store.get().web).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("версия установки", () => {
  it("читает ветку из packed-refs после git gc", async () => {
    const root = await tmp();
    try {
      await mkdir(path.join(root, ".git"));
      await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
      await writeFile(path.join(root, ".git", "packed-refs"), `# pack-refs with: peeled fully-peeled sorted\n${"d".repeat(40)} refs/heads/dev\n${SHA} refs/heads/main\n`);
      expect(requireMarker(root)).toBe(SHA);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("понимает рабочее дерево git (файл .git с gitdir)", async () => {
    const root = await tmp();
    try {
      const main = path.join(root, "main", ".git"), wt = path.join(main, "worktrees", "w"), dir = path.join(root, "w");
      await mkdir(wt, { recursive: true }); await mkdir(dir);
      await writeFile(path.join(dir, ".git"), `gitdir: ${wt}\n`);
      await writeFile(path.join(wt, "HEAD"), "ref: refs/heads/feature\n");
      await writeFile(path.join(wt, "commondir"), "../..\n");
      await mkdir(path.join(main, "refs", "heads"), { recursive: true });
      await writeFile(path.join(main, "refs", "heads", "feature"), SHA + "\n");
      expect(requireMarker(dir)).toBe(SHA);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("ZIP-копия, совпадающая с последней версией, получает её номер и не видит «обновления»", async () => {
    const root = await tmp();
    try {
      const pkg = Buffer.from('{"name":"x"}\n');
      await writeFile(path.join(root, "package.json"), pkg);
      let trees = 0;
      globalThis.fetch = vi.fn(async (url) => {
        const u = String(url);
        if (u.endsWith("/commits/main")) return new Response(JSON.stringify({ sha: SHA, commit: { message: "Up" } }));
        if (u.includes("/git/trees/")) { trees++; return new Response(JSON.stringify({ truncated: false, tree: [{ type: "blob", path: "package.json", size: pkg.length, sha: gitHash(pkg) }] })); }
        if (u.includes("/check-runs")) return new Response(JSON.stringify({ check_runs: [] }));
        return new Response("{}", { status: 404 });
      });
      const updater = new ProjectUpdater(root);
      expect(updater.status().localVersion).toBe("не определена");
      const st = await updater.check();
      expect(st.localVersion).toBe(SHA);
      expect((await readFile(path.join(root, ".juunibi-version"), "utf8")).trim()).toBe(SHA);
      await updater.check();
      expect(trees).toBe(1); // a known version is not compared again
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("ZIP-копия с другими файлами остаётся «не определена»", async () => {
    const root = await tmp();
    try {
      await writeFile(path.join(root, "package.json"), "changed");
      globalThis.fetch = vi.fn(async (url) => {
        const u = String(url);
        if (u.endsWith("/commits/main")) return new Response(JSON.stringify({ sha: SHA, commit: { message: "Up" } }));
        if (u.includes("/git/trees/")) return new Response(JSON.stringify({ truncated: false, tree: [{ type: "blob", path: "package.json", size: 1, sha: "e".repeat(40) }] }));
        return new Response(JSON.stringify({ check_runs: [] }));
      });
      const st = await new ProjectUpdater(root).check();
      expect(st.localVersion).toBe("не определена");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("/api/status", () => {
  it("называет модель, выбранную в настройках, а не модель по умолчанию", async () => {
    const { createApp } = await import("../src/app");
    let current = "picked/model";
    const server = createApp({ modules: () => [], configured: { model: "default/model" }, cloudStatus: () => ({ configured: false, model: current }) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/status`;
      expect((await (await fetch(url)).json()).model).toBe("picked/model");
      current = "other/model";
      expect((await (await fetch(url)).json()).model).toBe("other/model");
    } finally { server.close(); }
  });
});
