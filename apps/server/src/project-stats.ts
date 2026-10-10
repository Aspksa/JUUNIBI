/**
 * «Жизнь проекта» on the «Обновление» page: 50 figures about JUUNIBI's history.
 * A git checkout counts them itself (scripts/project-stats.mjs); an install from a ZIP has no history and
 * reads what GitHub Actions published to the `stats` branch. Figures only the running app knows (knowledge,
 * rollbacks, start-up time) are filled in on top.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const STATS_URL = "https://raw.githubusercontent.com/Aspksa/JUUNIBI/stats/project-stats.json";
const LOCAL_TTL = 10 * 60_000, REMOTE_TTL = 60 * 60_000;

export interface Metric {
  id: string; group: string; emoji: string; title: string; hint: string; value: string; detail: string;
  kind?: "hours" | "calendar" | "spark" | "list"; series?: number[]; list?: string[];
}
export interface ProjectStatsData {
  version: 1; generatedAt: string; head: string; commits: number;
  groups: { id: string; title: string }[]; metrics: Metric[];
  /** Where the figures came from: this checkout, GitHub, or the copy saved after the last successful download. */
  source?: "git" | "github" | "saved";
}
export type RuntimeFigures = Record<string, { value: string; detail?: string }>;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
/** Accepts only the expected shape; anything else from the network is dropped. */
export function cleanStats(raw: unknown): ProjectStatsData | null {
  const r = raw as Partial<ProjectStatsData> | null;
  if (!r || r.version !== 1 || !Array.isArray(r.metrics) || !Array.isArray(r.groups) || r.metrics.length > 100 || r.groups.length > 20) return null;
  const metrics: Metric[] = [];
  for (const m of r.metrics as unknown[]) {
    const x = m as Partial<Metric>;
    if (!x || typeof x.id !== "string" || typeof x.group !== "string") continue;
    const kind = x.kind === "hours" || x.kind === "calendar" || x.kind === "spark" || x.kind === "list" ? x.kind : undefined;
    metrics.push({
      id: str(x.id, 40), group: str(x.group, 40), emoji: str(x.emoji, 8), title: str(x.title, 80), hint: str(x.hint, 120),
      value: str(x.value, 60), detail: str(x.detail, 200),
      ...(kind ? { kind } : {}),
      ...(Array.isArray(x.series) ? { series: x.series.slice(0, 60).map((n) => (Number.isFinite(n) ? Number(n) : 0)) } : {}),
      ...(Array.isArray(x.list) ? { list: x.list.slice(0, 20).map((s) => str(s, 160)) } : {}),
    });
  }
  return {
    version: 1, generatedAt: str(r.generatedAt, 40), head: str(r.head, 40), commits: Number.isFinite(r.commits) ? Number(r.commits) : 0,
    groups: (r.groups as unknown[]).map((g) => ({ id: str((g as { id?: unknown }).id, 40), title: str((g as { title?: unknown }).title, 80) })),
    metrics,
  };
}

export class ProjectStats {
  private cache: { at: number; data: ProjectStatsData } | null = null;
  private pending: Promise<ProjectStatsData> | null = null;
  constructor(private readonly root: string, private readonly dataDir: string,
    private readonly runtime: () => Promise<RuntimeFigures> = async () => ({}),
    private readonly fetchImpl: typeof fetch = fetch) {}

  private get saved() { return path.join(this.dataDir, "project-stats.json"); }

  async get(force = false): Promise<ProjectStatsData> {
    const local = existsSync(path.join(this.root, ".git"));
    if (!force && this.cache && Date.now() - this.cache.at < (local ? LOCAL_TTL : REMOTE_TTL)) return this.withRuntime(this.cache.data);
    this.pending ??= (local ? this.fromGit() : this.fromGitHub()).finally(() => { this.pending = null; });
    const data = await this.pending;
    this.cache = { at: Date.now(), data };
    return this.withRuntime(data);
  }

  private async withRuntime(data: ProjectStatsData): Promise<ProjectStatsData> {
    let extra: RuntimeFigures = {};
    try { extra = await this.runtime(); } catch { /* the figures from history are still worth showing */ }
    return { ...data, metrics: data.metrics.map((m) => (extra[m.id] ? { ...m, value: extra[m.id]!.value, detail: extra[m.id]!.detail ?? m.detail } : m)) };
  }

  private fromGit(): Promise<ProjectStatsData> {
    return new Promise((resolve, reject) => {
      execFile(process.execPath, [path.join(this.root, "scripts", "project-stats.mjs")], { cwd: this.root, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, out) => {
        const data = err ? null : (() => { try { return cleanStats(JSON.parse(out)); } catch { return null; } })();
        if (data) resolve({ ...data, source: "git" });
        else this.fromGitHub().then(resolve, () => reject(new Error("Не удалось посчитать показатели по истории git")));
      });
    });
  }

  private async fromGitHub(): Promise<ProjectStatsData> {
    try {
      const r = await this.fetchImpl(STATS_URL + "?t=" + Math.floor(Date.now() / REMOTE_TTL), { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      const data = cleanStats(await r.json());
      if (!data) throw new Error("bad data");
      await mkdir(this.dataDir, { recursive: true });
      await writeFile(this.saved + ".tmp", JSON.stringify(data));
      await rename(this.saved + ".tmp", this.saved);
      return { ...data, source: "github" };
    } catch {
      try {
        const data = cleanStats(JSON.parse(await readFile(this.saved, "utf8")));
        if (data) return { ...data, source: "saved" };
      } catch { /* nothing saved yet */ }
      throw Object.assign(new Error("Показатели пока недоступны: GitHub не ответил, а сохранённой копии ещё нет. Они появятся, когда будет связь с GitHub."), { status: 503 });
    }
  }
}

/** Start-up time of this run next to the previous ones (kept in data/startup-times.json, last 10). */
export async function recordStartup(dataDir: string, ms: number): Promise<number[]> {
  const file = path.join(dataDir, "startup-times.json");
  let list: number[] = [];
  try { const raw: unknown = JSON.parse(await readFile(file, "utf8")); if (Array.isArray(raw)) list = raw.filter((n): n is number => Number.isFinite(n)).slice(-9); } catch { /* first run */ }
  list.push(Math.round(ms));
  try { await mkdir(dataDir, { recursive: true }); await writeFile(file, JSON.stringify(list)); } catch { /* read-only folder: still shown for this run */ }
  return list;
}
