import { createHash } from "node:crypto";
import { mkdir, writeFile, rm, readFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";

const REPO = "Aspksa/JUUNIBI";
const API = "https://api.github.com/repos/" + REPO;
const HEADERS = { "user-agent": "JUUNIBI-Updater", accept: "application/vnd.github+json" };
export type UpdatePhase = "idle" | "downloading" | "testing" | "ready" | "error";
export interface UpdateState {
  phase: UpdatePhase; percent: number; downloadedFiles: number; totalFiles: number;
  downloadedBytes: number; totalBytes: number; message: string; error?: string;
  /** Files dropped by the new release; deleted only after the user confirms (red in the UI). */
  pendingRemovals: string[]; removalsConfirmed: boolean;
}
interface Entry { path: string; sha: string; size: number; type: string }
export class ProjectUpdater {
  private state: UpdateState = { phase: "idle", percent: 0, downloadedFiles: 0, totalFiles: 0, downloadedBytes: 0, totalBytes: 0, message: "Ожидание", pendingRemovals: [], removalsConfirmed: false };
  private latest: { sha: string; version: string; description: string; date: string } | null = null;
  private busy = false;
  private operationId = randomUUID();
  private async emit(type: string, relative_path = "", status = "", extra: Record<string, unknown> = {}) {
    await mkdir(this.folder(), { recursive: true });
    await appendFile(path.join(this.folder(), "events.jsonl"), JSON.stringify({ event_id: randomUUID(), type, timestamp: new Date().toISOString(), operation_id: this.operationId, relative_path, status, ...extra }) + "\n");
  }
  async events() {
    try { const records = (await readFile(path.join(this.folder(), "events.jsonl"), "utf8")).trim().split("\n").flatMap(s => { try { return [JSON.parse(s)]; } catch { return []; } }); const manifest = [...records].reverse().find(e => e.type === "manifest_ready"); const recent = records.slice(-250); return manifest && !recent.some(e => e.event_id === manifest.event_id) ? [manifest, ...recent] : recent; }
    catch { return []; }
  }
  constructor(private readonly root: string) {}
  private folder() { return path.join(this.root, ".updates"); }
  isBusy() { return this.busy; }
  status() { return { ...this.state, latest: this.latest, localVersion: this.localVersion() }; }
  private localVersion(): string {
    try {
      const fs = requireMarker(this.root);
      return fs;
    } catch { return "не определена"; }
  }
  async check() {
    const response = await this.getJson(API + "/commits/main");
    const sha = String(response.sha);
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Неверный идентификатор GitHub");
    const version = String(response.commit?.message ?? "").split("\n")[0]!.slice(0, 160);
    this.latest = { sha, version: sha.slice(0, 8), description: "Обновление проекта из GitHub. Коммит: " + (version || "без описания"), date: String(response.commit?.committer?.date ?? "") };
    return this.status();
  }
  async start() {
    if (this.busy) throw new Error("Обновление уже выполняется");
    // Claim the slot and switch the phase synchronously, before any await, so concurrent callers see it.
    this.busy = true;
    this.operationId = randomUUID();
    this.state = { phase: "downloading", percent: 0, downloadedFiles: 0, totalFiles: 0, downloadedBytes: 0, totalBytes: 0, message: "Подключение к GitHub", pendingRemovals: [], removalsConfirmed: false };
    try {
      await mkdir(this.folder(), {recursive:true});
      await rm(path.join(this.folder(), "ready.json"), {force:true});
      await writeFile(path.join(this.folder(), "events.jsonl"), "");
      await this.emit("update_check_started", "", "checking");
      await rm(path.join(this.folder(), "removals-confirmed.json"), { force: true });
      await this.check();
      const sha = this.latest!.sha;
      const tree = await this.getJson(API + "/git/trees/" + sha + "?recursive=1");
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("Неполный список файлов GitHub");
      const entries: Entry[] = tree.tree.filter((x: Entry) => x.type === "blob");
      if (entries.some(e => !safeRelative(e.path) || !/^[0-9a-f]{40}$/.test(e.sha)) || new Set(entries.map(e => e.path.toLowerCase())).size !== entries.length) throw new Error("Недопустимый путь или повтор файла в манифесте");
      if (entries.length > 2500 || entries.some(x => !Number.isSafeInteger(x.size) || x.size < 0 || x.size > 15_000_000)) throw new Error("Превышены ограничения размера обновления");
      const total = entries.reduce((sum, e) => sum + e.size, 0);
      if (total > 100_000_000) throw new Error("Размер обновления превышает 100 МБ");
      this.state.totalFiles = entries.length; this.state.totalBytes = total;
      const changes = await Promise.all(entries.map(async e => {
        try { const prior = await readFile(path.join(this.root, e.path)); return { path: e.path, change_type: gitHash(prior) === e.sha ? "unchanged" : "modified", size: e.size }; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return { path: e.path, change_type: "added", size: e.size }; }
      }));
      const removals = await this.findRemovals(entries);
      this.state.pendingRemovals = removals;
      await this.emit("manifest_ready", "", "ready", { files: [...changes, ...removals.map(p => ({ path: p, change_type: "removed", size: 0 }))], sha });
      const staging = path.join(this.folder(), "staging");
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      for (const e of entries) {
        const change_type = changes.find(x=>x.path===e.path)?.change_type ?? "modified";
        await this.emit("download_started", e.path, "downloading", {change_type,target_relative_path:e.path});
        if (!safeRelative(e.path) || !/^[0-9a-f]{40}$/.test(e.sha)) throw new Error("Недопустимый файл в обновлении");
        const response = await fetch("https://raw.githubusercontent.com/" + REPO + "/" + sha + "/" + e.path.split("/").map(encodeURIComponent).join("/"), { headers: HEADERS, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error("Не удалось скачать " + e.path + ": HTTP " + response.status);
        const chunks: Buffer[] = [];
        let size = 0;
        let lastProgress = 0;
        if (!response.body) throw new Error("Пустой ответ GitHub: " + e.path);
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
            this.state.percent = total ? Math.min(100, Math.floor(100 * this.state.downloadedBytes / total)) : 100;
          }
        } finally { reader.releaseLock(); }
        const data = Buffer.concat(chunks);
        await this.emit("file_verify_started", e.path, "verifying", {change_type});
        if (size !== e.size || gitHash(data) !== e.sha) throw new Error("Ошибка контроля целостности: " + e.path);
        await this.emit("file_verify_done", e.path, "verified", {change_type});
        const dest = path.join(staging, e.path);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, data);
        this.state.downloadedFiles++;
        await this.emit("file_download_done", e.path, "downloaded", { change_type, bytes_done: size, bytes_total:e.size, target_relative_path:e.path });
        this.state.message = "Скачано: " + e.path;
      }
      this.state.phase = "testing"; this.state.message = "Установка зависимостей и проверка тестов";
      await this.run(staging, "npm", ["ci", "--no-audit", "--no-fund"]);
      await this.run(staging, "npm", ["run", "typecheck"]);
      await this.run(staging, "npm", ["test"]);
      await this.run(staging, "npm", ["run", "build"]);
      await writeFile(path.join(this.folder(), "ready.json"), JSON.stringify({ sha, files: entries.map(e => ({ path: e.path, sha: e.sha })), removals, description: this.latest!.description }));
      await this.emit("update_prepared", "", "ready", {sha});
      this.state.phase = "ready";
      this.state.message = "Проверки пройдены. Перезапустите JUUNIBI для установки.";
    } catch (e) {
      await this.emit("update_failed", "", "failed", {message: e instanceof Error ? e.message : String(e)}).catch(()=>{});
      this.state.phase = "error";
      this.state.error = e instanceof Error ? e.message : String(e);
      this.state.message = "Не удалось подготовить обновление";
      await rm(path.join(this.folder(), "ready.json"), { force: true }).catch(() => {});
    } finally { this.busy = false; }
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
  private async run(cwd: string, command: string, args: string[]) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"], timeout: 900_000 });
      let output = "";
      const capture = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-32_000); };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
      child.on("error", reject);
      child.on("exit", async (code) => {
        if (code === 0) return resolve();
        try {
          const log = path.join(this.folder(), "test-output.log");
          await writeFile(log, output, { mode: 0o600 });
          reject(new Error(command + " " + args.join(" ") + " завершился с кодом " + code + ". Подробности: .updates/test-output.log"));
        } catch { reject(new Error(command + " " + args.join(" ") + " завершился с кодом " + code)); }
      });
    });
  }
  private async getJson(url: string): Promise<any> {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("GitHub API: HTTP " + response.status);
    return response.json();
  }
}
function gitHash(buf: Buffer) {
  return createHash("sha1").update("blob " + buf.length + "\0").update(buf).digest("hex");
}
function safeRelative(p: string) {
  return !!p && p.length < 1024 && !p.startsWith("/") && !p.includes("\\") && !p.includes(":") && p.split("/").every(s => !!s && s !== "." && s !== ".." && ![".git", ".updates", ".env", "data", ".runtime", "node_modules", ".juunibi-version"].includes(s) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s) && !/[. ]$/.test(s));
}
import { readFileSync } from "node:fs";
function requireMarker(root: string): string {
  try { return readFileSync(path.join(root, ".juunibi-version"), "utf8").trim().slice(0, 40); }
  catch {
    try {
      const head = readFileSync(path.join(root, ".git", "HEAD"), "utf8").trim();
      return /^[a-f0-9]{40}$/.test(head) ? head : (head.startsWith("ref: ") ? readFileSync(path.join(root, ".git", head.slice(5)), "utf8").trim() : "не определена");
    } catch { return "не определена"; }
  }
}
