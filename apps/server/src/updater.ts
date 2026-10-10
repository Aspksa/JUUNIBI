import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rm, readFile, appendFile, copyFile, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type SpawnOptionsWithStdioTuple } from "node:child_process";

const REPO = "Aspksa/JUUNIBI";
const API = "https://api.github.com/repos/" + REPO;
const HEADERS = { "user-agent": "JUUNIBI-Updater", accept: "application/vnd.github+json" };
const MAX_ATTEMPTS = 3;
const MAX_DOWNLOAD_BYTES = 100_000_000;

export type UpdatePhase = "idle" | "downloading" | "testing" | "ready" | "error";
export type Channel = "fresh" | "stable";
export type AutoCheck = "off" | "hourly" | "daily";
export interface UpdateConfig { channel: Channel; autoCheck: AutoCheck }
/** Result of the project's own CI for the commit that would be installed. */
export type CiState = "success" | "pending" | "failure" | "none" | "unknown";
export interface ChangeNote { sha: string; title: string; pr?: number }
export interface CheckStep { id: "install" | "typecheck" | "test" | "build"; title: string; status: "todo" | "active" | "done" | "error" }
export interface LatestInfo {
  sha: string; version: string; description: string; date: string;
  channel: Channel; tag?: string; ci: CiState;
  /** Commits between the installed version and this one, newest first (empty when the installed version is unknown). */
  changes: ChangeNote[]; changesTotal: number;
}
export interface UpdateState {
  phase: UpdatePhase; percent: number; downloadedFiles: number; totalFiles: number;
  downloadedBytes: number; totalBytes: number; message: string; error?: string;
  /** Files already identical on disk: not downloaded, copied for the checks. */
  reusedFiles: number;
  /** Size of the whole release tree (what is NOT downloaded is `treeBytes - totalBytes`). */
  treeBytes: number;
  /** Progress of the checks run in the temporary folder. */
  checks: CheckStep[];
  /** Last lines of the failed check, so the reason is visible without opening files. */
  logTail?: string;
  /** Files dropped by the new release; deleted only after the user confirms (red in the UI). */
  pendingRemovals: string[]; removalsConfirmed: boolean;
}
export interface HistoryItem { id: string; at: string; kind: "install" | "rollback" | "failed" | "startup_failed"; from: string; to: string; backup?: string; rollbackOf?: string; message?: string; files?: number }
export interface UpdaterOptions {
  /** Install only commits whose CI is green (default on; JUUNIBI_UPDATE_REQUIRE_CI=0 turns it off for forks). */
  requireCi?: boolean;
  token?: string;
  retryDelaysMs?: number[];
  /** Replaces running npm in the temporary folder (tests). */
  runner?: (cwd: string, command: string, args: string[], signal: AbortSignal) => Promise<void>;
}
interface Entry { path: string; sha: string; size: number; type: string }

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "GitHubError"; }
}
class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "HttpError"; }
}

const CHECK_TITLES: Record<CheckStep["id"], string> = { install: "Установка зависимостей", typecheck: "Проверка типов", test: "Тесты", build: "Сборка" };
const freshChecks = (): CheckStep[] => (Object.keys(CHECK_TITLES) as CheckStep["id"][]).map((id) => ({ id, title: CHECK_TITLES[id], status: "todo" }));
const blankState = (): UpdateState => ({
  phase: "idle", percent: 0, downloadedFiles: 0, totalFiles: 0, downloadedBytes: 0, totalBytes: 0, message: "Ожидание",
  reusedFiles: 0, treeBytes: 0, checks: freshChecks(), pendingRemovals: [], removalsConfirmed: false,
});
const DEFAULT_CONFIG: UpdateConfig = { channel: "fresh", autoCheck: "hourly" };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Variables that could carry secrets are not handed to the downloaded code that runs during the checks. */
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(k)) env[k] = v;
  return env;
}

/** Fetch with its own timeout that also follows an outer cancel signal. */
async function fetchTimed(url: string, init: RequestInit, ms: number, outer?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("Истекло время ожидания")), ms);
  const onAbort = () => ctl.abort(outer?.reason);
  if (outer) { if (outer.aborted) onAbort(); else outer.addEventListener("abort", onAbort, { once: true }); }
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(timer); outer?.removeEventListener("abort", onAbort); }
}

/** Pure: the newest install whose backup was not yet restored (installs are undone strictly in reverse order). */
export function rollbackTarget(history: HistoryItem[], hasBackup: (name: string) => boolean = () => true): HistoryItem | null {
  const stack: HistoryItem[] = [];
  for (const h of history) {
    if (h.kind === "install" && h.backup) stack.push(h);
    if (h.rollbackOf) { const i = stack.findIndex((s) => s.backup === h.rollbackOf); if (i >= 0) stack.splice(i, 1); }
  }
  for (let i = stack.length - 1; i >= 0; i--) if (hasBackup(stack[i]!.backup!)) return stack[i]!;
  return null;
}

export class ProjectUpdater {
  private state: UpdateState = blankState();
  private latest: LatestInfo | null = null;
  private busy = false;
  private operationId = randomUUID();
  private abort: AbortController | null = null;
  private child: ChildProcess | null = null;
  private checkedAt = 0;
  private rateLimitUntil = 0;
  private config: UpdateConfig = { ...DEFAULT_CONFIG };
  private rollbackPending = false;
  private readonly requireCi: boolean;
  private readonly token: string;
  private readonly retryDelays: number[];

  private readonly runner: UpdaterOptions["runner"];
  constructor(private readonly root: string, opts: UpdaterOptions = {}) {
    this.runner = opts.runner;
    this.requireCi = opts.requireCi ?? process.env.JUUNIBI_UPDATE_REQUIRE_CI !== "0";
    this.token = (opts.token ?? process.env.GITHUB_TOKEN ?? "").trim();
    this.retryDelays = opts.retryDelaysMs ?? [1000, 3000];
    try {
      const c = JSON.parse(readFileSync(path.join(this.folder(), "config.json"), "utf8")) as Partial<UpdateConfig>;
      if (c.channel === "fresh" || c.channel === "stable") this.config.channel = c.channel;
      if (c.autoCheck === "off" || c.autoCheck === "hourly" || c.autoCheck === "daily") this.config.autoCheck = c.autoCheck;
    } catch { /* defaults */ }
    this.rollbackPending = existsSync(path.join(this.folder(), "rollback-request.json"));
  }

  private folder() { return path.join(this.root, ".updates"); }
  private async emit(type: string, relative_path = "", status = "", extra: Record<string, unknown> = {}) {
    await mkdir(this.folder(), { recursive: true });
    await appendFile(path.join(this.folder(), "events.jsonl"), JSON.stringify({ event_id: randomUUID(), type, timestamp: new Date().toISOString(), operation_id: this.operationId, relative_path, status, ...extra }) + "\n");
  }
  async events() {
    try { const records = (await readFile(path.join(this.folder(), "events.jsonl"), "utf8")).trim().split("\n").flatMap(s => { try { return [JSON.parse(s)]; } catch { return []; } }); const manifest = [...records].reverse().find(e => e.type === "manifest_ready"); const recent = records.slice(-250); return manifest && !recent.some(e => e.event_id === manifest.event_id) ? [manifest, ...recent] : recent; }
    catch { return []; }
  }
  isBusy() { return this.busy; }
  getConfig(): UpdateConfig { return { ...this.config }; }
  lastCheckedAt() { return this.checkedAt; }
  status() {
    return { ...this.state, latest: this.latest, localVersion: this.localVersion(), config: this.getConfig(), rollbackPending: this.rollbackPending, blocked: this.blocked() };
  }
  private localVersion(): string {
    try { return requireMarker(this.root); } catch { return UNKNOWN_VERSION; }
  }

  /** Why the newest version cannot be installed right now (null = it can). */
  blocked(): string | null {
    const l = this.latest;
    if (!l || !this.requireCi) return null;
    switch (l.ci) {
      case "success": return null;
      case "pending": return "Автоматические проверки (CI) этой версии ещё идут — обновление станет доступно, когда они завершатся.";
      case "failure": return "Автоматические проверки (CI) этой версии не пройдены — устанавливать её небезопасно.";
      case "none": return "У этой версии нет результатов автоматических проверок (CI) — обновление недоступно.";
      default: return "Не удалось получить результат автоматических проверок (CI) — повторите проверку позже.";
    }
  }

  async setConfig(patch: unknown): Promise<UpdateConfig> {
    const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
    const next = { ...this.config };
    if (p.channel !== undefined) { if (p.channel !== "fresh" && p.channel !== "stable") throw Object.assign(new Error("Канал: fresh или stable"), { status: 400 }); next.channel = p.channel; }
    if (p.autoCheck !== undefined) { if (p.autoCheck !== "off" && p.autoCheck !== "hourly" && p.autoCheck !== "daily") throw Object.assign(new Error("Автопроверка: off, hourly или daily"), { status: 400 }); next.autoCheck = p.autoCheck; }
    if (this.busy && next.channel !== this.config.channel) throw Object.assign(new Error("Дождитесь окончания подготовки обновления"), { status: 409 });
    const channelChanged = next.channel !== this.config.channel;
    await mkdir(this.folder(), { recursive: true });
    const file = path.join(this.folder(), "config.json");
    const tmp = file + "." + randomUUID().slice(0, 8) + ".tmp";
    await writeFile(tmp, JSON.stringify(next)); await rename(tmp, file);
    this.config = next;
    if (channelChanged) { this.latest = null; this.checkedAt = 0; }
    return this.getConfig();
  }

  async check(force = true) {
    if (!force && (this.busy || (this.latest && Date.now() - this.checkedAt < 60_000) || Date.now() < this.rateLimitUntil)) return this.status();
    let target: { sha: string; message: string; date: string; tag?: string };
    if (this.config.channel === "stable") {
      let rel: any;
      try { rel = await this.getJson(API + "/releases/latest"); }
      catch (e) { if (e instanceof GitHubError && e.status === 404) throw Object.assign(new Error("В репозитории пока нет стабильных выпусков. Выберите канал «Свежий»."), { status: 409 }); throw e; }
      const tag = String(rel.tag_name ?? "");
      if (!/^[\w.\-+/]{1,100}$/.test(tag)) throw new Error("Неверное имя выпуска GitHub");
      const c = await this.getJson(API + "/commits/" + encodeURIComponent(tag));
      target = { sha: String(c.sha), message: String(c.commit?.message ?? ""), date: String(c.commit?.committer?.date ?? ""), tag };
    } else {
      const c = await this.getJson(API + "/commits/main");
      target = { sha: String(c.sha), message: String(c.commit?.message ?? ""), date: String(c.commit?.committer?.date ?? "") };
    }
    if (!/^[a-f0-9]{40}$/.test(target.sha)) throw new Error("Неверный идентификатор GitHub");
    const title = target.message.split("\n")[0]!.slice(0, 160);
    await this.adoptIfIdentical(target.sha);
    const [ci, notes] = await Promise.all([this.ciState(target.sha), this.whatChanged(target.sha)]);
    this.latest = {
      sha: target.sha, version: target.tag ?? target.sha.slice(0, 8), channel: this.config.channel, ...(target.tag ? { tag: target.tag } : {}),
      description: "Обновление проекта из GitHub. Коммит: " + (title || "без описания"), date: target.date, ci,
      changes: notes.items, changesTotal: notes.total,
    };
    this.checkedAt = Date.now();
    return this.status();
  }

  /**
   * An install without a version marker (a ZIP copy, no .git) whose files are exactly the files of `sha` IS that
   * version: the marker is written so no update that changes nothing is offered. Best effort.
   */
  private async adoptIfIdentical(sha: string) {
    if (this.localVersion() !== UNKNOWN_VERSION) return;
    try {
      const tree = await this.getJson(API + "/git/trees/" + sha + "?recursive=1");
      if (tree.truncated || !Array.isArray(tree.tree)) return;
      const blobs = (tree.tree as Entry[]).filter((x) => x.type === "blob" && safeRelative(x.path) && /^[0-9a-f]{40}$/.test(x.sha));
      if (!blobs.length || blobs.length > 2500) return;
      for (const e of blobs) {
        const bytes = await readFile(path.join(this.root, e.path)).catch(() => null);
        if (!bytes || gitHash(bytes) !== e.sha) return; // something differs: this is not that version
      }
      await writeFile(path.join(this.root, ".juunibi-version"), sha + "\n");
    } catch { /* the version stays unknown */ }
  }

  /** CI verdict of a commit. Any failure to find out is "unknown", never a silent pass. */
  private async ciState(sha: string): Promise<CiState> {
    try {
      const r = await this.getJson(API + "/commits/" + sha + "/check-runs?per_page=100");
      const runs: { status?: string; conclusion?: string | null }[] = Array.isArray(r.check_runs) ? r.check_runs : [];
      if (!runs.length) return "none";
      if (runs.some((x) => x.status !== "completed")) return "pending";
      if (runs.some((x) => !["success", "neutral", "skipped"].includes(String(x.conclusion)))) return "failure";
      return "success";
    } catch { return "unknown"; }
  }

  /** Titles of the commits between the installed version and `sha` (newest first). Best effort: empty on any problem. */
  private async whatChanged(sha: string): Promise<{ items: ChangeNote[]; total: number }> {
    const local = this.localVersion();
    if (!/^[a-f0-9]{40}$/.test(local) || local === sha) return { items: [], total: 0 };
    try {
      const r = await this.getJson(API + "/compare/" + local + "..." + sha);
      const commits: any[] = Array.isArray(r.commits) ? r.commits : [];
      const items = commits.slice(-30).reverse().map((c) => {
        const title = String(c.commit?.message ?? "").split("\n")[0]!.trim().slice(0, 140);
        const pr = /\(#(\d{1,7})\)\s*$/.exec(title)?.[1];
        return { sha: String(c.sha ?? "").slice(0, 8), title: title.replace(/\s*\(#\d+\)\s*$/, "") || "без описания", ...(pr ? { pr: Number(pr) } : {}) };
      });
      const total = Number.isSafeInteger(r.total_commits) ? r.total_commits : commits.length;
      return { items, total };
    } catch { return { items: [], total: 0 }; }
  }

  async start() {
    if (this.busy) throw new Error("Обновление уже выполняется");
    // Claim the slot and switch the phase synchronously, before any await, so concurrent callers see it.
    this.busy = true;
    const abort = this.abort = new AbortController();
    const signal = abort.signal;
    this.operationId = randomUUID();
    this.state = { ...blankState(), phase: "downloading", message: "Подключение к GitHub" };
    try {
      await mkdir(this.folder(), {recursive:true});
      await rm(path.join(this.folder(), "ready.json"), {force:true});
      await writeFile(path.join(this.folder(), "events.jsonl"), "");
      await this.emit("update_check_started", "", "checking");
      await rm(path.join(this.folder(), "removals-confirmed.json"), { force: true });
      await this.check(true);
      const why = this.blocked();
      if (why) throw new Error(why);
      const sha = this.latest!.sha;
      const tree = await this.getJson(API + "/git/trees/" + sha + "?recursive=1", signal);
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("Неполный список файлов GitHub");
      const entries: Entry[] = tree.tree.filter((x: Entry) => x.type === "blob");
      if (entries.some(e => !safeRelative(e.path) || !/^[0-9a-f]{40}$/.test(e.sha)) || new Set(entries.map(e => e.path.toLowerCase())).size !== entries.length) throw new Error("Недопустимый путь или повтор файла в манифесте");
      if (entries.length > 2500 || entries.some(x => !Number.isSafeInteger(x.size) || x.size < 0 || x.size > 15_000_000)) throw new Error("Превышены ограничения размера обновления");
      const changes = await Promise.all(entries.map(async e => {
        try { const prior = await readFile(path.join(this.root, e.path)); return { path: e.path, change_type: gitHash(prior) === e.sha ? "unchanged" : "modified", size: e.size }; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "EISDIR") throw error; return { path: e.path, change_type: "added", size: e.size }; }
      }));
      const changeOf = new Map(changes.map(c => [c.path, c.change_type]));
      const toFetch = entries.filter(e => changeOf.get(e.path) !== "unchanged");
      const treeBytes = entries.reduce((sum, e) => sum + e.size, 0);
      const fetchBytes = toFetch.reduce((sum, e) => sum + e.size, 0);
      if (fetchBytes > MAX_DOWNLOAD_BYTES) throw new Error("Размер обновления превышает 100 МБ");
      this.state.totalFiles = toFetch.length; this.state.totalBytes = fetchBytes; this.state.treeBytes = treeBytes;
      const removals = await this.findRemovals(entries);
      this.state.pendingRemovals = removals;
      await this.emit("manifest_ready", "", "ready", { files: [...changes, ...removals.map(p => ({ path: p, change_type: "removed", size: 0 }))], sha });

      // Verified files of an interrupted attempt for the SAME commit are kept; anything else starts clean.
      const staging = path.join(this.folder(), "staging");
      const marker = path.join(this.folder(), "staging.sha");
      const sameCommit = (await readFile(marker, "utf8").catch(() => "")).trim() === sha;
      if (!sameCommit) await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      await writeFile(marker, sha + "\n");

      for (const e of entries) {
        if (signal.aborted) throw new Error("cancelled");
        if (!safeRelative(e.path) || !/^[0-9a-f]{40}$/.test(e.sha)) throw new Error("Недопустимый файл в обновлении");
        const change_type = changeOf.get(e.path) ?? "modified";
        const dest = path.join(staging, e.path);
        await mkdir(path.dirname(dest), { recursive: true });
        if (change_type === "unchanged") { // already on disk with the right hash: no need to download it again
          await copyFile(path.join(this.root, e.path), dest);
          this.state.reusedFiles++;
          continue;
        }
        await this.emit("download_started", e.path, "downloading", {change_type,target_relative_path:e.path});
        const kept = sameCommit ? await readFile(dest).catch(() => null) : null;
        let data: Buffer;
        if (kept && gitHash(kept) === e.sha) { data = kept; this.state.downloadedBytes += e.size; } // resumed
        else {
          data = await this.download(sha, e, change_type, signal);
          await this.emit("file_verify_started", e.path, "verifying", {change_type});
          if (data.length !== e.size || gitHash(data) !== e.sha) throw new Error("Ошибка контроля целостности: " + e.path);
          await writeFile(dest, data);
        }
        this.state.percent = fetchBytes ? Math.min(100, Math.floor(100 * this.state.downloadedBytes / fetchBytes)) : 100;
        await this.emit("file_verify_done", e.path, "verified", {change_type});
        this.state.downloadedFiles++;
        await this.emit("file_download_done", e.path, "downloaded", { change_type, bytes_done: e.size, bytes_total:e.size, target_relative_path:e.path });
        this.state.message = "Скачано: " + e.path;
      }
      this.state.percent = 100;
      this.state.phase = "testing"; this.state.message = "Установка зависимостей и проверка тестов";
      // Scripts of dependencies are never run: the downloaded code is only installed, type-checked, tested and built.
      await this.step("install", "npm", ["ci", "--no-audit", "--no-fund", "--ignore-scripts"], staging);
      await this.step("typecheck", "npm", ["run", "typecheck"], staging);
      await this.step("test", "npm", ["test"], staging);
      await this.step("build", "npm", ["run", "build"], staging);
      await writeFile(path.join(this.folder(), "ready.json"), JSON.stringify({ sha, files: entries.map(e => ({ path: e.path, sha: e.sha })), removals, description: this.latest!.description }));
      await this.emit("update_prepared", "", "ready", {sha});
      this.state.phase = "ready";
      this.state.message = "Проверки пройдены. Перезапустите JUUNIBI для установки.";
    } catch (e) {
      await rm(path.join(this.folder(), "ready.json"), { force: true }).catch(() => {});
      if (signal.aborted) {
        this.state = { ...blankState(), message: "Подготовка обновления отменена" };
        await this.emit("update_cancelled", "", "cancelled").catch(() => {});
      } else {
        await this.emit("update_failed", "", "failed", {message: e instanceof Error ? e.message : String(e)}).catch(()=>{});
        this.state.phase = "error";
        this.state.error = e instanceof Error ? e.message : String(e);
        this.state.message = "Не удалось подготовить обновление";
      }
    } finally { this.busy = false; this.abort = null; this.child = null; }
  }

  /** Stops the preparation: the download or the running check is interrupted, nothing is installed. */
  cancel() {
    if (!this.busy || !this.abort) throw new Error("Нечего отменять");
    this.abort.abort(new Error("cancelled"));
    this.killChild();
    return this.status();
  }

  /** Downloads one file, retrying short network failures and server errors (not 404/403). */
  private async download(sha: string, e: Entry, change_type: string, signal: AbortSignal): Promise<Buffer> {
    const url = "https://raw.githubusercontent.com/" + REPO + "/" + sha + "/" + e.path.split("/").map(encodeURIComponent).join("/");
    for (let attempt = 1; ; attempt++) {
      const before = this.state.downloadedBytes;
      try {
        const response = await fetchTimed(url, { headers: HEADERS }, 60_000, signal);
        if (!response.ok) throw new HttpError("Не удалось скачать " + e.path + ": HTTP " + response.status, response.status);
        if (!response.body) throw new Error("Пустой ответ GitHub: " + e.path);
        const chunks: Buffer[] = [];
        let size = 0, lastProgress = 0;
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const b = Buffer.from(value); size += b.byteLength;
            if (size > e.size) throw new Error("Размер файла не совпадает: " + e.path);
            chunks.push(b); this.state.downloadedBytes += b.byteLength;
            const now = Date.now();
            if (e.size > 262_144 && now - lastProgress >= 250) {
              lastProgress = now;
              await this.emit("file_download_progress", e.path, "downloading", { change_type, bytes_done: size, bytes_total: e.size, target_relative_path: e.path });
            }
            this.state.percent = this.state.totalBytes ? Math.min(100, Math.floor(100 * this.state.downloadedBytes / this.state.totalBytes)) : 100;
          }
        } finally { reader.releaseLock(); }
        return Buffer.concat(chunks);
      } catch (err) {
        this.state.downloadedBytes = before;
        const fatal = signal.aborted || (err instanceof HttpError && err.status < 500 && err.status !== 429 && err.status !== 408);
        if (fatal || attempt >= MAX_ATTEMPTS) throw err;
        this.state.message = `Повтор загрузки (${attempt + 1} из ${MAX_ATTEMPTS}): ${e.path}`;
        await sleep(this.retryDelays[attempt - 1] ?? 0);
      }
    }
  }

  /** Files installed by the previous release that the new tree no longer contains. Only ever files WE installed. */
  private async findRemovals(entries: Entry[]): Promise<string[]> {
    let prev: { paths?: unknown } | null = null;
    try { prev = JSON.parse(await readFile(path.join(this.folder(), "installed.json"), "utf8")); } catch { return []; }
    if (!prev || !Array.isArray(prev.paths)) return [];
    const keep = new Set(entries.map(e => e.path.toLowerCase()));
    const out: string[] = [];
    for (const p of prev.paths) {
      if (typeof p !== "string" || !safeRelative(p) || keep.has(p.toLowerCase())) continue;
      try { await readFile(path.join(this.root, p)); out.push(p); } catch { /* already gone */ }
    }
    return out.slice(0, 2500);
  }
  /** User approves deleting the listed files for the prepared update. Nothing is deleted before the installer runs. */
  async confirmRemovals() {
    if (this.state.phase !== "ready") throw new Error("Нет подготовленного обновления");
    const ready = JSON.parse(await readFile(path.join(this.folder(), "ready.json"), "utf8"));
    if (!Array.isArray(ready.removals) || !ready.removals.length) throw new Error("Нечего удалять");
    await writeFile(path.join(this.folder(), "removals-confirmed.json"), JSON.stringify({ sha: ready.sha, paths: ready.removals }));
    this.state.removalsConfirmed = true;
    await this.emit("removals_confirmed", "", "confirmed", { count: ready.removals.length });
    return this.status();
  }

  // ---------- history and manual rollback (the launcher performs the rollback on the next start) ----------
  private async readHistory(): Promise<HistoryItem[]> {
    try {
      return (await readFile(path.join(this.folder(), "history.jsonl"), "utf8")).trim().split("\n").slice(-200)
        .flatMap((s) => { try { const h = JSON.parse(s); return h && typeof h.id === "string" && typeof h.kind === "string" ? [h as HistoryItem] : []; } catch { return []; } });
    } catch { return []; }
  }
  private hasBackup = (name: string) => /^[\w.-]+$/.test(name) && existsSync(path.join(this.folder(), "backups", name, ".meta.json"));
  async history() {
    const all = await this.readHistory();
    const target = rollbackTarget(all, this.hasBackup);
    return { items: all.slice(-30).reverse(), canRollback: target && !existsSync(path.join(this.folder(), "ready.json")) ? target : null, rollbackPending: this.rollbackPending };
  }
  async requestRollback() {
    if (this.busy) throw Object.assign(new Error("Дождитесь окончания подготовки обновления"), { status: 409 });
    if (existsSync(path.join(this.folder(), "ready.json"))) throw Object.assign(new Error("Сначала установите или отмените подготовленное обновление"), { status: 409 });
    const target = rollbackTarget(await this.readHistory(), this.hasBackup);
    if (!target?.backup) throw Object.assign(new Error("Нет установки, которую можно откатить"), { status: 409 });
    await mkdir(this.folder(), { recursive: true });
    await writeFile(path.join(this.folder(), "rollback-request.json"), JSON.stringify({ backup: target.backup, at: new Date().toISOString() }));
    this.rollbackPending = true;
    return this.status();
  }
  async cancelRollback() {
    await rm(path.join(this.folder(), "rollback-request.json"), { force: true });
    this.rollbackPending = false;
    return this.status();
  }

  // ---------- running the checks ----------
  private async step(id: CheckStep["id"], command: string, args: string[], cwd: string) {
    const s = this.state.checks.find((c) => c.id === id)!;
    s.status = "active"; this.state.message = s.title;
    try { await this.run(cwd, command, args); s.status = "done"; }
    catch (e) { s.status = "error"; throw e; }
  }
  private killChild() {
    const c = this.child;
    if (!c?.pid) return;
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
      else c.kill("SIGTERM");
    } catch { /* already gone */ }
  }
  private async run(cwd: string, command: string, args: string[]) {
    if (this.runner) return this.runner(cwd, command, args, this.abort?.signal ?? new AbortController().signal);
    await new Promise<void>((resolve, reject) => {
      const env = scrubbedEnv();
      const opts: SpawnOptionsWithStdioTuple<"ignore", "pipe", "pipe"> = { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 900_000, env };
      // Windows runs npm through its .cmd wrapper, which needs cmd.exe. It is invoked explicitly instead of
      // spawn(shell: true), which Node 24 deprecates (DEP0190). Commands and arguments here are fixed literals.
      const child = process.platform === "win32"
        ? spawn(env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], { ...opts, windowsVerbatimArguments: true })
        : spawn(command, args, opts);
      this.child = child;
      let output = "";
      const capture = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-32_000); };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
      child.on("error", reject);
      child.on("exit", async (code) => {
        this.child = null;
        if (code === 0) return resolve();
        if (this.abort?.signal.aborted) return reject(new Error("cancelled"));
        this.state.logTail = output.split(/\r?\n/).filter(Boolean).slice(-25).join("\n").slice(-3000);
        try {
          const log = path.join(this.folder(), "test-output.log");
          await writeFile(log, output, { mode: 0o600 });
          reject(new Error(command + " " + args.join(" ") + " завершился с кодом " + code + ". Подробности: .updates/test-output.log"));
        } catch { reject(new Error(command + " " + args.join(" ") + " завершился с кодом " + code)); }
      });
    });
  }

  private async getJson(url: string, signal?: AbortSignal): Promise<any> {
    if (Date.now() < this.rateLimitUntil) throw new GitHubError(this.rateLimitMessage(), 429);
    const headers: Record<string, string> = { ...HEADERS, ...(this.token ? { authorization: "Bearer " + this.token } : {}) };
    const response = await fetchTimed(url, { headers }, 20000, signal);
    if (!response.ok) {
      if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(response.headers.get("x-ratelimit-reset"));
        this.rateLimitUntil = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 10 * 60_000;
        throw new GitHubError(this.rateLimitMessage(), 429);
      }
      throw new GitHubError("GitHub API: HTTP " + response.status, response.status);
    }
    return response.json();
  }
  private rateLimitMessage() {
    const at = new Date(this.rateLimitUntil).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return `Лимит запросов GitHub исчерпан — повторите после ${at}. Можно указать GITHUB_TOKEN в .env, чтобы лимит стал выше.`;
  }
}
function gitHash(buf: Buffer) {
  return createHash("sha1").update("blob " + buf.length + "\0").update(buf).digest("hex");
}
function safeRelative(p: string) {
  return !!p && p.length < 1024 && !p.startsWith("/") && !p.includes("\\") && !p.includes(":") && p.split("/").every(s => !!s && s !== "." && s !== ".." && ![".git", ".updates", ".env", "data", ".runtime", "node_modules", ".juunibi-version"].includes(s) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s) && !/[. ]$/.test(s));
}
const UNKNOWN_VERSION = "не определена";
/** Installed version: the marker written by the installer, else the commit checked out by git. */
export function requireMarker(root: string): string {
  try { return readFileSync(path.join(root, ".juunibi-version"), "utf8").trim().slice(0, 40); }
  catch { return gitHead(root) ?? UNKNOWN_VERSION; }
}
/** Commit of HEAD without running git: follows a worktree's "gitdir:" file and refs packed by `git gc`. */
function gitHead(root: string): string | null {
  const dotGit = path.join(root, ".git");
  const direct = headIn(dotGit);
  if (direct) return direct;
  try { // a worktree or submodule has a FILE ".git" that points to the real folder
    const link = readFileSync(dotGit, "utf8").trim();
    return link.startsWith("gitdir: ") ? headIn(path.resolve(root, link.slice(8).trim())) : null;
  } catch { return null; }
}
function headIn(gitDir: string): string | null {
  try {
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[a-f0-9]{40}$/.test(head)) return head;
    if (!head.startsWith("ref: ")) return null;
    const ref = head.slice(5).trim();
    if (!/^refs\/[\w./-]+$/.test(ref) || ref.includes("..")) return null;
    // A worktree keeps branch refs in the main repository (commondir).
    let common = gitDir;
    try { common = path.resolve(gitDir, readFileSync(path.join(gitDir, "commondir"), "utf8").trim()); } catch { /* not a worktree */ }
    for (const dir of common === gitDir ? [gitDir] : [common, gitDir]) {
      try { const sha = readFileSync(path.join(dir, ref), "utf8").trim(); if (/^[a-f0-9]{40}$/.test(sha)) return sha; } catch { /* packed */ }
      try {
        for (const line of readFileSync(path.join(dir, "packed-refs"), "utf8").split(/\r?\n/)) {
          const m = /^([a-f0-9]{40}) (\S+)$/.exec(line.trim());
          if (m && m[2] === ref) return m[1]!;
        }
      } catch { /* no packed refs */ }
    }
    return null;
  } catch { return null; }
}
