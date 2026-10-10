import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProjectUpdater, rollbackTarget, type HistoryItem } from "../src/updater";

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
        if (u.includes("/check-runs")) return new Response(JSON.stringify({ check_runs: [{ status: "completed", conclusion: "success" }] }));
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

  describe("безопасность и надёжность", () => {
    const blob = (t: string) => createHash("sha1").update("blob " + Buffer.byteLength(t) + "\0").update(t).digest("hex");
    const SHA = "c".repeat(40);
    type Gh = { files: Record<string, string>; ci?: unknown; raw?: (path: string, attempt: number) => Response | undefined; headers?: Record<string, string>; calls: string[] };
    const github = (o: Gh) => {
      const attempts = new Map<string, number>();
      globalThis.fetch = vi.fn(async (url) => {
        const u = String(url); o.calls.push(u);
        if (u.endsWith("/commits/main")) return new Response(JSON.stringify({ sha: SHA, commit: { message: "feat: x (#7)", committer: { date: "2026-10-09T00:00:00Z" } } }));
        if (u.includes("/check-runs")) return new Response(JSON.stringify(o.ci ?? { check_runs: [{ status: "completed", conclusion: "success" }] }));
        if (u.includes("/git/trees/")) return new Response(JSON.stringify({ truncated: false, tree: Object.entries(o.files).map(([p, t]) => ({ type: "blob", path: p, size: Buffer.byteLength(t), sha: blob(t) })) }));
        if (u.includes("raw.githubusercontent.com")) {
          const rel = decodeURIComponent(u.split(SHA + "/")[1]!);
          const n = (attempts.get(rel) ?? 0) + 1; attempts.set(rel, n);
          return o.raw?.(rel, n) ?? new Response(o.files[rel]!);
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch;
    };
    const tmp = async () => mkdtemp(path.join(os.tmpdir(), "juunibi-update-"));
    const quick = { retryDelaysMs: [0, 0] };

    it("ставит зависимости без запуска их скриптов и не передаёт секреты проверкам", async () => {
      const root = await tmp(); const calls: string[][] = [];
      try {
        github({ files: { "package.json": "{}" }, calls: [] });
        const u = new ProjectUpdater(root, { ...quick, runner: async (_c, cmd, args) => { calls.push([cmd, ...args]); } });
        await u.start();
        expect(u.status().phase).toBe("ready");
        expect(calls[0]).toEqual(["npm", "ci", "--no-audit", "--no-fund", "--ignore-scripts"]);
        expect(calls.map((c) => c[2] ?? c[1])).toEqual(["--no-audit", "typecheck", "test", "build"]);
        expect(u.status().checks.every((c) => c.status === "done")).toBe(true);
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it("не скачивает версию, пока не пройден CI", async () => {
      for (const [ci, text] of [[{ check_runs: [{ status: "in_progress", conclusion: null }] }, /ещё идут/], [{ check_runs: [{ status: "completed", conclusion: "failure" }] }, /не пройдены/], [{ check_runs: [] }, /нет результатов/]] as const) {
        const root = await tmp(); const calls: string[] = [];
        try {
          github({ files: { "a.txt": "a" }, ci, calls });
          const u = new ProjectUpdater(root, quick);
          await u.check();
          expect(u.status().blocked).toMatch(text);
          await u.start();
          expect(u.status().phase).toBe("error");
          expect(u.status().error).toMatch(text);
          expect(calls.some((c) => c.includes("raw.githubusercontent"))).toBe(false);
        } finally { await rm(root, { recursive: true, force: true }); }
      }
    });

    it("при недоступном CI не ставит, а с отключённым требованием — ставит", async () => {
      const root = await tmp();
      try {
        github({ files: { "a.txt": "a" }, calls: [] });
        const base = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url, init) => String(url).includes("/check-runs") ? new Response("oops", { status: 500 }) : base(url, init)) as typeof fetch;
        const strict = new ProjectUpdater(root, quick);
        expect((await strict.check()).latest?.ci).toBe("unknown");
        expect(strict.status().blocked).toMatch(/Не удалось получить результат/);
        await strict.start();
        expect(strict.status().phase).toBe("error");
        const relaxed = new ProjectUpdater(root, { ...quick, requireCi: false, runner: async () => {} });
        await relaxed.start();
        expect(relaxed.status().phase).toBe("ready");
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it("берёт неизменённые файлы с диска, скачивает только новые и сообщает размер", async () => {
      const root = await tmp(); const calls: string[] = [];
      try {
        await writeFile(path.join(root, "same.txt"), "same");
        github({ files: { "same.txt": "same", "new.txt": "brand new" }, calls });
        const u = new ProjectUpdater(root, { ...quick, runner: async () => {} });
        await u.start();
        const st = u.status();
        expect(st.phase).toBe("ready");
        expect(st.reusedFiles).toBe(1);
        expect(st.totalFiles).toBe(1);
        expect(st.totalBytes).toBe(9);
        expect(st.treeBytes).toBe(13);
        expect(calls.filter((c) => c.includes("raw.githubusercontent")).map((c) => c.split(SHA + "/")[1])).toEqual(["new.txt"]);
        expect(await readFile(path.join(root, ".updates", "staging", "same.txt"), "utf8")).toBe("same");
        const ready = JSON.parse(await readFile(path.join(root, ".updates", "ready.json"), "utf8"));
        expect(ready.files.map((f: { path: string }) => f.path).sort()).toEqual(["new.txt", "same.txt"]);
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it("повторяет сбой сервера, но не повторяет 404, и продолжает с уже проверенных файлов", async () => {
      const root = await tmp(); const calls: string[] = [];
      try {
        github({ files: { "a.txt": "aaa", "b.txt": "bbb" }, calls, raw: (p, n) => (p === "a.txt" && n < 3 ? new Response("err", { status: 503 }) : undefined) });
        const u1 = new ProjectUpdater(root, { ...quick, runner: async () => { throw new Error("тесты упали"); } });
        await u1.start();
        expect(u1.status().phase).toBe("error");
        expect(calls.filter((c) => c.endsWith("a.txt")).length).toBe(3); // two failures + success
        // second attempt for the same commit reuses the verified files in staging
        calls.length = 0;
        const u2 = new ProjectUpdater(root, { ...quick, runner: async () => {} });
        await u2.start();
        expect(u2.status().phase).toBe("ready");
        expect(calls.some((c) => c.includes("raw.githubusercontent"))).toBe(false);
        // 404 is final
        const root2 = await tmp();
        try {
          calls.length = 0;
          github({ files: { "a.txt": "aaa" }, calls, raw: () => new Response("no", { status: 404 }) });
          const u3 = new ProjectUpdater(root2, quick);
          await u3.start();
          expect(u3.status().error).toMatch(/HTTP 404/);
          expect(calls.filter((c) => c.includes("raw.githubusercontent")).length).toBe(1);
        } finally { await rm(root2, { recursive: true, force: true }); }
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it("отмена останавливает подготовку и ничего не оставляет готовым к установке", async () => {
      const root = await tmp();
      try {
        github({ files: { "a.txt": "a" }, calls: [] });
        let release!: () => void;
        const u = new ProjectUpdater(root, { ...quick, runner: (_c, _m, _a, signal) => new Promise<void>((_ok, bad) => { release = () => {}; signal.addEventListener("abort", () => bad(new Error("cancelled"))); }) });
        const run = u.start();
        for (let i = 0; i < 100 && u.status().phase !== "testing"; i++) await new Promise((r) => setTimeout(r, 10));
        expect(u.status().phase).toBe("testing");
        u.cancel(); release();
        await run;
        expect(u.status().phase).toBe("idle");
        expect(u.status().error).toBeUndefined();
        await expect(readFile(path.join(root, ".updates", "ready.json"))).rejects.toThrow();
        expect(() => u.cancel()).toThrow(/Нечего отменять/);
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it("понятно сообщает о лимите GitHub и не стучится снова до его окончания", async () => {
      const root = await tmp(); let n = 0;
      try {
        const reset = Math.floor(Date.now() / 1000) + 600;
        globalThis.fetch = vi.fn(async () => { n++; return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }); }) as typeof fetch;
        const u = new ProjectUpdater(root, quick);
        await expect(u.check()).rejects.toThrow(/Лимит запросов GitHub исчерпан/);
        await expect(u.check()).rejects.toThrow(/Лимит запросов/);
        expect(n).toBe(1);
        expect((await u.check(false)).latest).toBeNull(); // the background check stays silent
        expect(n).toBe(1);
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it("показывает, что изменилось между установленной и новой версией", async () => {
      const root = await tmp();
      try {
        await writeFile(path.join(root, ".juunibi-version"), "d".repeat(40) + "\n");
        const calls: string[] = [];
        github({ files: { "a.txt": "a" }, calls });
        const base = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url, init) => String(url).includes("/compare/") ? new Response(JSON.stringify({ total_commits: 2, commits: [
          { sha: "1".repeat(40), commit: { message: "fix: старое\n\nподробности" } },
          { sha: "2".repeat(40), commit: { message: "feat: новое (#12)" } },
        ] })) : base(url, init)) as typeof fetch;
        const u = new ProjectUpdater(root, quick);
        const latest = (await u.check()).latest!;
        expect(latest.changesTotal).toBe(2);
        expect(latest.changes).toEqual([{ sha: "22222222", title: "feat: новое", pr: 12 }, { sha: "11111111", title: "fix: старое" }]);
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it("канал «Стабильный» берёт последний выпуск; без выпусков объясняет, что делать", async () => {
      const root = await tmp();
      try {
        const calls: string[] = [];
        github({ files: { "a.txt": "a" }, calls });
        const base = globalThis.fetch;
        let hasRelease = false;
        globalThis.fetch = vi.fn(async (url, init) => {
          const u = String(url);
          if (u.endsWith("/releases/latest")) return hasRelease ? new Response(JSON.stringify({ tag_name: "v1.2.0" })) : new Response("{}", { status: 404 });
          if (u.endsWith("/commits/v1.2.0")) return new Response(JSON.stringify({ sha: SHA, commit: { message: "release" } }));
          return base(url, init);
        }) as typeof fetch;
        const u = new ProjectUpdater(root, quick);
        await u.setConfig({ channel: "stable" });
        await expect(u.check()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/нет стабильных выпусков/) });
        hasRelease = true;
        const latest = (await u.check()).latest!;
        expect(latest.version).toBe("v1.2.0");
        expect(latest.channel).toBe("stable");
        // the choice survives a restart
        expect(new ProjectUpdater(root, quick).getConfig().channel).toBe("stable");
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it("настройки обновления проверяются", async () => {
      const root = await tmp();
      try {
        const u = new ProjectUpdater(root, quick);
        await expect(u.setConfig({ channel: "nightly" })).rejects.toMatchObject({ status: 400 });
        await expect(u.setConfig({ autoCheck: "often" })).rejects.toMatchObject({ status: 400 });
        expect(await u.setConfig({ autoCheck: "off" })).toEqual({ channel: "fresh", autoCheck: "off" });
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  });

  describe("откат", () => {
    const item = (o: Partial<HistoryItem> & { id: string; kind: HistoryItem["kind"] }): HistoryItem => ({ at: "2026-10-09T00:00:00Z", from: "", to: "", ...o });
    it("предлагает откатить последнюю установку, которую ещё не откатывали", () => {
      const h = [item({ id: "1", kind: "install", backup: "b1" }), item({ id: "2", kind: "install", backup: "b2" })];
      expect(rollbackTarget(h)?.backup).toBe("b2");
      h.push(item({ id: "3", kind: "rollback", rollbackOf: "b2" }));
      expect(rollbackTarget(h)?.backup).toBe("b1");
      h.push(item({ id: "4", kind: "startup_failed", rollbackOf: "b1" }));
      expect(rollbackTarget(h)).toBeNull();
    });
    it("пропускает установки, у которых резервная копия удалена", () => {
      const h = [item({ id: "1", kind: "install", backup: "b1" }), item({ id: "2", kind: "install", backup: "b2" })];
      expect(rollbackTarget(h, (n) => n === "b1")?.backup).toBe("b1");
      expect(rollbackTarget(h, () => false)).toBeNull();
    });
    it("просьба об откате записывается только при наличии копии и когда нет готового обновления", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-update-"));
      try {
        const u = new ProjectUpdater(root);
        await expect(u.requestRollback()).rejects.toMatchObject({ status: 409 });
        const dir = path.join(root, ".updates"), backup = path.join(dir, "backups", "2026-b1");
        await mkdir(backup, { recursive: true });
        await writeFile(path.join(backup, ".meta.json"), "{}");
        await writeFile(path.join(dir, "history.jsonl"), JSON.stringify({ id: "1", at: "2026-10-09T00:00:00Z", kind: "install", from: "a", to: "b", backup: "2026-b1" }) + "\n");
        expect((await u.history()).canRollback?.backup).toBe("2026-b1");
        await writeFile(path.join(dir, "ready.json"), "{}");
        await expect(u.requestRollback()).rejects.toThrow(/Сначала установите/);
        await rm(path.join(dir, "ready.json"));
        expect((await u.requestRollback()).rollbackPending).toBe(true);
        expect(JSON.parse(await readFile(path.join(dir, "rollback-request.json"), "utf8")).backup).toBe("2026-b1");
        expect((await u.cancelRollback()).rollbackPending).toBe(false);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  });
});
