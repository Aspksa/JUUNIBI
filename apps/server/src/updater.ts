import { createHash } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
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
      const staging = path.join(this.folder(), "staging");
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      for (const e of entries) {
        if (!safeRelative(e.path) || !/^[0-9a-f]{40}$/.test(e.sha)) throw new Error("Недопустимый файл в обновлении");
        const response = await fetch("https://raw.githubusercontent.com/" + REPO + "/" + sha + "/" + e.path.split("/").map(encodeURIComponent).join("/"), { headers: HEADERS, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error("Не удалось скачать " + e.path + ": HTTP " + response.status);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response.body ?? []) {
          const b = Buffer.from(chunk); size += b.byteLength;
          if (size > e.size) throw new Error("Размер файла не совпадает: " + e.path);
          chunks.push(b); this.state.downloadedBytes += b.byteLength;
          this.state.percent = total ? Math.min(100, Math.floor(100 * this.state.downloadedBytes / total)) : 100;
        }
        const data = Buffer.concat(chunks);
        if (size !== e.size || gitHash(data) !== e.sha) throw new Error("Ошибка контроля целостности: " + e.path);
        const dest = path.join(staging, e.path);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, data);
        this.state.downloadedFiles++;
        this.state.message = "Скачано: " + e.path;
      }
      this.state.phase = "testing"; this.state.message = "Установка зависимостей и проверка тестов";
      await this.run(staging, "npm", ["ci", "--no-audit", "--no-fund"]);
      await this.run(staging, "npm", ["run", "typecheck"]);
      await this.run(staging, "npm", ["test"]);
      await this.run(staging, "npm", ["run", "build"]);
      await writeFile(path.join(this.folder(), "ready.json"), JSON.stringify({ sha, files: entries.map(e => e.path), description: this.latest!.description }));
      this.state.phase = "ready";
      this.state.message = "Проверки пройдены. Перезапустите JUUNIBI для установки.";
    } catch (e) {
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
      return /^[a-f0-9]{40}$/.test(head) ? head.slice(0, 8) : (head.startsWith("ref: ") ? readFileSync(path.join(root, ".git", head.slice(5)), "utf8").trim().slice(0, 8) : "не определена");
    } catch { return "не определена"; }
  }
}
