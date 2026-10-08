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
}
interface Entry { path: string; sha: string; size: number; type: string }
export class ProjectUpdater {
  private state: UpdateState = { phase: "idle", percent: 0, downloadedFiles: 0, totalFiles: 0, downloadedBytes: 0, totalBytes: 0, message: "Ожидание" };
  private latest: { sha: string; version: string; description: string; date: string } | null = null;
  private busy = false;
  private operationId = randomUUID();
  private async emit(type: string, relative_path = "", status = "", extra: Record<string, unknown> = {}) {
    await mkdir(this.folder(), { recursive: true });
    await appendFile(path.join(this.folder(), "events.jsonl"), JSON.stringify({ event_id: randomUUID(), type, timestamp: new Date().toISOString(), operation_id: this.operationId, relative_path, status, ...extra }) + "\n");
  }
  async events() {
    try { const rows = (await readFile(path.join(this.folder(), "events.jsonl"), "utf8")).trim().split("\n").slice(-250); return rows.flatMap(s => { try { return [JSON.parse(s)]; } catch { return []; } }); }
    catch { return []; }
  }
  constructor(private readonly root: string) {}
  private folder() { return path.join(this.root, ".updates"); }
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
    this.busy = true;
    this.operationId = randomUUID();
    await mkdir(this.folder(), {recursive:true});
    await writeFile(path.join(this.folder(), "events.jsonl"), "");
    await this.emit("update_check_started", "", "checking");
    this.state = { phase: "downloading", percent: 0, downloadedFiles: 0, totalFiles: 0, downloadedBytes: 0, totalBytes: 0, message: "Подключение к GitHub" };
    try {
      await this.check();
      const sha = this.latest!.sha;
      const tree = await this.getJson(API + "/git/trees/" + sha + "?recursive=1");
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("Неполный список файлов GitHub");
      const entries: Entry[] = tree.tree.filter((x: Entry) => x.type === "blob");
      if (entries.length > 2500 || entries.some(x => !Number.isSafeInteger(x.size) || x.size < 0 || x.size > 15_000_000)) throw new Error("Превышены ограничения размера обновления");
      const total = entries.reduce((sum, e) => sum + e.size, 0);
      if (total > 100_000_000) throw new Error("Размер обновления превышает 100 МБ");
      this.state.totalFiles = entries.length; this.state.totalBytes = total;
      const changes = await Promise.all(entries.map(async e => {
        try { const prior = await readFile(path.join(this.root, e.path)); return { path: e.path, change_type: gitHash(prior) === e.sha ? "unchanged" : "modified", size: e.size }; }
        catch { return { path: e.path, change_type: "added", size: e.size }; }
      }));
      await this.emit("manifest_ready", "", "ready", { files: changes, sha });
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
        if (!response.body) throw new Error("Пустой ответ GitHub: " + e.path);
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const b = Buffer.from(value); size += b.byteLength;
            if (size > e.size) throw new Error("Размер файла не совпадает: " + e.path);
            chunks.push(b); this.state.downloadedBytes += b.byteLength;
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
      await writeFile(path.join(this.folder(), "ready.json"), JSON.stringify({ sha, files: entries.map(e => ({ path: e.path, sha: e.sha })), description: this.latest!.description }));
      await this.emit("update_prepared", "", "ready", {sha});
      this.state.phase = "ready";
      this.state.message = "Проверки пройдены. Перезапустите JUUNIBI для установки.";
    } catch (e) {
      await this.emit("update_failed", "", "failed", {message: e instanceof Error ? e.message : String(e)}).catch(()=>{});
      this.state.phase = "error";
      this.state.error = e instanceof Error ? e.message : String(e);
      this.state.message = "Не удалось подготовить обновление";
      await rm(path.join(this.folder(), "ready.json"), { force: true });
    } finally { this.busy = false; }
  }
  private async run(cwd: string, command: string, args: string[]) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd, shell: process.platform === "win32", stdio: "ignore", timeout: 180_000 });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(command + " " + args.join(" ") + " завершился с кодом " + code)));
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
  return !!p && !p.startsWith("/") && !p.includes("\\") && p.split("/").every(s => !!s && s !== "." && s !== ".." && ![".git", ".updates", ".env", "data", ".runtime", "node_modules"].includes(s));
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
