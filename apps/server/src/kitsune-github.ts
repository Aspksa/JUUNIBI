import type { ProjectUpdater } from "./updater";

const CACHE_MS = 2 * 60_000;
type Entry = { at: number; value: unknown };

/**
 * Public pull requests and CI results of the project for the Kitsune tree. The browser page may not call GitHub
 * itself (the page's security policy forbids it), so the server does it, with the token, cache and rate-limit
 * handling of the update centre. Only a few fields are passed on.
 */
export class KitsuneGithub {
  private cache = new Map<string, Entry>();
  constructor(private readonly github: Pick<ProjectUpdater, "githubGet">) {}

  private async cached(key: string, load: () => Promise<unknown>): Promise<unknown> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  pulls(): Promise<unknown[]> {
    return this.cached("pulls", async () => {
      const raw = await this.github.githubGet("/pulls?state=all&per_page=30");
      if (!Array.isArray(raw)) return [];
      return raw.slice(0, 30).map((p: Record<string, any>) => ({
        number: p?.number, title: p?.title, html_url: p?.html_url, state: p?.state,
        created_at: p?.created_at, merged_at: p?.merged_at ?? null, head: { sha: p?.head?.sha },
      }));
    }) as Promise<unknown[]>;
  }

  runs(sha: string): Promise<unknown> {
    if (!/^[0-9a-f]{40}$/.test(sha)) return Promise.reject(new Error("Некорректный SHA"));
    return this.cached("runs:" + sha, async () => {
      const raw = await this.github.githubGet("/actions/runs?head_sha=" + sha + "&per_page=5");
      const runs: Record<string, any>[] = Array.isArray(raw?.workflow_runs) ? raw.workflow_runs : [];
      return { workflow_runs: runs.slice(0, 5).map((r) => ({ status: r?.status, conclusion: r?.conclusion ?? null, created_at: r?.created_at })) };
    });
  }
}
