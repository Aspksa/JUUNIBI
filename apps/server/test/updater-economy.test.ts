import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectUpdater } from "../src/updater";

const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; vi.restoreAllMocks(); });
const SHA = "a".repeat(40);
const withRoot = async (fn: (root: string) => Promise<void>) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-economy-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("economical update checks", () => {
  it("sends If-None-Match and reuses the cached answer on 304", async () => withRoot(async (root) => {
    const seen: (string | null)[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      if (String(url).endsWith("/commits/main")) {
        seen.push(h.get("if-none-match"));
        if (h.get("if-none-match") === '"v1"') return new Response(null, { status: 304 });
        return new Response(JSON.stringify({ sha: SHA, commit: { message: "Fix" } }), { headers: { etag: '"v1"' } });
      }
      return new Response(JSON.stringify({ check_runs: [] }));
    }) as typeof fetch;
    const u = new ProjectUpdater(root, { token: "" });
    expect((await u.check()).latest?.sha).toBe(SHA);
    expect((await u.check()).latest?.sha).toBe(SHA);
    expect(seen).toEqual([null, '"v1"']);
  }));

  it("remembers the last check and a rate limit across restarts", async () => withRoot(async (root) => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    let limited = false;
    const f = vi.fn(async () => limited
      ? new Response("limit", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } })
      : new Response(JSON.stringify({ sha: SHA, commit: { message: "Fix" }, check_runs: [] })));
    globalThis.fetch = f as unknown as typeof fetch;
    await new ProjectUpdater(root, { token: "" }).check();
    await settle();
    const calls = f.mock.calls.length;
    // A restart right after a check does not ask GitHub again.
    const again = new ProjectUpdater(root, { token: "" });
    expect((await again.check(false)).latest?.sha).toBe(SHA);
    expect(f.mock.calls.length).toBe(calls);

    limited = true;
    await expect(again.check()).rejects.toMatchObject({ status: 429 });
    await settle();
    const afterLimit = f.mock.calls.length;
    const third = new ProjectUpdater(root, { token: "" });
    await expect(third.check()).rejects.toThrow(/Лимит запросов GitHub исчерпан/);
    expect(f.mock.calls.length).toBe(afterLimit); // no request while the limit lasts, even after a restart
    expect(third.status().github.rateLimitedUntil).toBe(reset * 1000);
  }));

  it("treats a secondary limit (429 with Retry-After) as a limit too", async () => withRoot(async (root) => {
    globalThis.fetch = vi.fn(async () => new Response("slow down", { status: 429, headers: { "retry-after": "120" } })) as unknown as typeof fetch;
    const u = new ProjectUpdater(root, { token: "" });
    await expect(u.check()).rejects.toMatchObject({ status: 429 });
    const until = u.status().github.rateLimitedUntil!;
    expect(until - Date.now()).toBeGreaterThan(100_000);
    expect(until - Date.now()).toBeLessThanOrEqual(120_000);
  }));

  it("saves a GitHub token privately, sends it, and can remove it", async () => withRoot(async (root) => {
    const auth: (string | null)[] = [];
    globalThis.fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get("authorization"));
      return new Response(JSON.stringify({ sha: SHA, commit: { message: "Fix" }, check_runs: [] }));
    }) as typeof fetch;
    const u = new ProjectUpdater(root, { token: "" });
    await expect(u.setConfig({ githubToken: "short" })).rejects.toMatchObject({ status: 400 });
    await u.setConfig({ githubToken: "ghp_" + "x".repeat(36) });
    expect(u.status().github.token).toBe("saved");
    expect(JSON.stringify(u.status())).not.toContain("ghp_");
    if (process.platform !== "win32") expect((await stat(path.join(root, ".updates", "github-token"))).mode & 0o777).toBe(0o600);
    await u.check();
    expect(auth[0]).toBe("Bearer ghp_" + "x".repeat(36));
    expect(new ProjectUpdater(root, { token: "" }).status().github.token).toBe("saved");
    await u.setConfig({ githubToken: "" });
    expect(u.status().github.token).toBe("none");
    await expect(readFile(path.join(root, ".updates", "github-token"))).rejects.toThrow();
  }));
});
