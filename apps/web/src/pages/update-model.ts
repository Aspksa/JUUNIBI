/** Pure view-model of the update centre. Everything shown comes from real status/events — nothing is estimated or faked. */
import type { UpdateCi, UpdateEvent, UpdateStatus } from "../api";

export type StepStatus = "todo" | "active" | "done" | "error";
export interface Step { id: string; title: string; detail: string; status: StepStatus; progress?: number }
export type Change = "added" | "modified" | "removed" | "unchanged";
export type FileState = "waiting" | "downloading" | "downloaded" | "verified" | "installed" | "removed" | "failed";
export interface FileRow { path: string; change: Change; state: FileState; size: number }
export type Tone = "neutral" | "ok" | "info" | "busy" | "danger";
export type Action = "check" | "download" | "busy" | "restart";
/** What happened at the last installation: installed, rolled back after a failure, new version did not start, or rolled back by hand. */
export type InstalledKind = "install" | "failed" | "startup_failed" | "rollback";
export interface Installed { ok: boolean; sha: string; healthy: boolean | null; backup: string; at: string; message: string; kind: InstalledKind }
export interface UpdateModel {
  tone: Tone; headline: string; sub: string; action: Action;
  steps: Step[];
  counts: Record<Change, number>;
  files: FileRow[];
  installed: Installed | null;
  current: string;
  health: { ok: boolean; message: string } | null;
  /** Reason the newest version cannot be downloaded yet (CI not green); "" = it can. */
  blocked: string;
  ci: UpdateCi | null;
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;
}
const dedupe = (events: UpdateEvent[]) => {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.event_id) ? false : (seen.add(e.event_id), true))).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
};
const asChange = (c: string | undefined): Change => (c === "added" || c === "modified" || c === "removed" ? c : "unchanged");

export function buildUpdateModel(u: UpdateStatus | null, rawEvents: UpdateEvent[]): UpdateModel {
  const events = dedupe(rawEvents);
  const phase = u?.phase ?? "idle";

  // ---- the manifest of the prepared update and per-file states
  const manifest = [...events].reverse().find((e) => e.type === "manifest_ready");
  const after = manifest ? events.filter((e) => e.timestamp >= manifest.timestamp) : events;
  const sets = (type: string) => new Set(after.filter((e) => e.type === type && e.relative_path).map((e) => e.relative_path));
  const downloaded = sets("file_download_done"), verified = sets("file_verify_done"), installed = sets("file_install_done"), failed = sets("file_install_failed"), removed = sets("file_remove_done");
  const startedDl = [...after].reverse().find((e) => e.type === "download_started" && e.relative_path);
  const currentDl = startedDl && !downloaded.has(startedDl.relative_path) && phase === "downloading" ? startedDl.relative_path : "";
  const files: FileRow[] = (manifest?.files ?? []).map((f) => {
    const change = asChange(f.change_type);
    const state: FileState = failed.has(f.path) ? "failed" : removed.has(f.path) ? "removed" : installed.has(f.path) ? "installed"
      : verified.has(f.path) ? "verified" : downloaded.has(f.path) ? "downloaded" : f.path === currentDl ? "downloading" : "waiting";
    return { path: f.path, change, state, size: f.size };
  });
  const counts: Record<Change, number> = { added: 0, modified: 0, removed: 0, unchanged: 0 };
  for (const f of files) counts[f.change]++;

  // ---- result of the last installation (done by the launcher on the next start)
  const lastPrepared = [...events].reverse().find((e) => e.type === "update_prepared");
  const afterPrepared = (e: UpdateEvent) => !lastPrepared || e.timestamp >= lastPrepared.timestamp;
  const completed = [...events].reverse().find((e) => e.type === "update_completed" && afterPrepared(e));
  const rolled = [...events].reverse().find((e) => e.type === "rollback_done" && afterPrepared(e));
  const healthEv = [...events].reverse().find((e) => e.type === "health_check_done");
  const health = healthEv ? { ok: healthEv.status === "healthy", message: healthEv.message ?? "" } : null;
  let installedInfo: Installed | null = null;
  // The newest of "installed" and "rolled back" is what the person needs to see.
  if (rolled && (!completed || rolled.timestamp >= completed.timestamp)) {
    const reason = String((rolled as UpdateEvent & { reason?: string }).reason ?? "install_failed");
    const fail = [...events].reverse().find((e) => e.type === "update_failed");
    if (reason === "rollback") installedInfo = { ok: true, sha: "", healthy: null, backup: "", at: rolled.timestamp, message: "Выполнен откат на предыдущую версию.", kind: "rollback" };
    else if (reason === "startup_failed") installedInfo = { ok: false, sha: "", healthy: null, backup: "", at: rolled.timestamp, message: rolled.message || "Новая версия не запустилась — возвращена прежняя.", kind: "startup_failed" };
    else installedInfo = { ok: false, sha: "", healthy: health ? health.ok : null, backup: "", at: rolled.timestamp, message: fail?.message ?? "Установка не удалась, изменения откатаны.", kind: "failed" };
  } else if (completed) {
    const sha = String((completed as UpdateEvent & { sha?: string }).sha ?? "");
    if (!u || !sha || u.localVersion === sha) {
      installedInfo = { ok: true, sha, healthy: health ? health.ok : null, backup: String((completed as UpdateEvent & { backup_relative_path?: string }).backup_relative_path ?? ""), at: completed.timestamp, message: "", kind: "install" };
    }
  }

  // ---- headline & primary action
  const hasNew = !!u?.latest && u.localVersion !== u.latest.sha;
  let tone: Tone = "neutral", headline = "Проверьте наличие обновлений", sub = "JUUNIBI сверится с GitHub и ничего не установит без вашего ведома.", action: Action = "check";
  if (!u) { tone = "busy"; headline = "Загрузка…"; sub = ""; action = "busy"; }
  else if (phase === "downloading") {
    tone = "busy"; action = "busy"; headline = "Скачиваем обновление";
    sub = `${u.downloadedFiles} из ${u.totalFiles} файлов · ${formatBytes(u.downloadedBytes)} из ${formatBytes(u.totalBytes)}`;
  } else if (phase === "testing") {
    tone = "busy"; action = "busy"; headline = "Проверяем обновление"; sub = "Устанавливаем зависимости, гоняем тесты и собираем проект во временной папке. Работающая версия не затрагивается.";
  } else if (phase === "ready") {
    tone = "ok"; action = "restart"; headline = "Обновление готово к установке";
    sub = "Установка пройдёт с резервной копией и проверкой запуска; если новая версия не запустится, вернётся прежняя.";
  } else if (phase === "error") {
    tone = "danger"; action = hasNew ? "download" : "check"; headline = "Не удалось подготовить обновление"; sub = u.error || u.message || "Попробуйте ещё раз.";
  } else if (hasNew) {
    tone = "info"; action = "download"; headline = "Доступна новая версия"; sub = u!.latest!.description;
  } else if (u.latest) {
    tone = "ok"; headline = "У вас последняя версия"; sub = "Новых изменений на GitHub нет.";
  }

  // ---- pipeline
  const total = u?.totalFiles ?? 0;
  const verifiedCount = verified.size;
  const failedWhere: "download" | "tests" | null = phase === "error" ? ((u?.downloadedFiles ?? 0) < total || total === 0 ? "download" : "tests") : null;
  const stepStatus = (id: "check" | "download" | "verify" | "tests" | "ready" | "install"): StepStatus => {
    const done = phase === "testing" || phase === "ready";
    switch (id) {
      case "check": return u?.latest ? "done" : "todo";
      case "download": return failedWhere === "download" ? "error" : phase === "downloading" ? "active" : done || (phase === "idle" && !!installedInfo?.ok) ? "done" : "todo";
      case "verify": return failedWhere === "download" ? "todo" : phase === "downloading" ? (verifiedCount > 0 ? "active" : "todo") : done || (phase === "idle" && !!installedInfo?.ok) ? "done" : "todo";
      case "tests": return failedWhere === "tests" ? "error" : phase === "testing" ? "active" : phase === "ready" || (phase === "idle" && !!installedInfo?.ok) ? "done" : "todo";
      case "ready": return phase === "ready" || (phase === "idle" && !!installedInfo?.ok) ? "done" : "todo";
      case "install": return installedInfo ? (installedInfo.ok ? "done" : "error") : "todo";
    }
  };
  const steps: Step[] = [
    { id: "check", title: "Проверка версии", status: stepStatus("check"), detail: u?.latest ? `Найдена ${u.latest.version}` : "Ещё не проверялось" },
    { id: "download", title: "Загрузка файлов", status: stepStatus("download"), detail: total ? `${u?.downloadedFiles ?? 0} из ${total}` : "Ожидание", ...(phase === "downloading" ? { progress: u?.percent ?? 0 } : {}) },
    { id: "verify", title: "Проверка целостности", status: stepStatus("verify"), detail: total && (phase === "downloading" || verifiedCount) ? `${Math.min(verifiedCount, total)} из ${total} по хешам` : "Хеши каждого файла" },
    { id: "tests", title: "Тесты и сборка", status: stepStatus("tests"), detail: phase === "testing" ? "Идёт проверка" : phase === "ready" ? "Пройдено" : failedWhere === "tests" ? "Не пройдено" : "Во временной папке" },
    { id: "ready", title: "Готово к установке", status: stepStatus("ready"), detail: phase === "ready" ? "Нужен перезапуск" : "—" },
    { id: "install", title: "Установка", status: stepStatus("install"), detail: installedInfo ? (installedInfo.ok ? (installedInfo.kind === "rollback" ? "Откат выполнен" : installedInfo.healthy === false ? "Установлено, проверка запуска не пройдена" : "Установлено и проверено") : "Откат выполнен") : "Кнопка «Установить сейчас» или запуск лаунчера" },
  ];

  // ---- the file currently in motion (for the transfer lane)
  const moving = [...after].reverse().find((e) => e.relative_path && ["download_started", "file_download_done", "file_install_start"].includes(e.type));
  return { tone, headline, sub, action, steps, counts, files, installed: installedInfo, current: moving?.relative_path ?? "", health, blocked: hasNew && phase !== "ready" ? (u?.blocked ?? "") : "", ci: u?.latest?.ci ?? null };
}

// ---------- grouping for the change list ----------
export interface Group { dir: string; files: FileRow[]; done: number; failed: number }
export const ROOT_DIR = "Корень проекта";
export const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ROOT_DIR);
export type Filter = "changed" | "added" | "modified" | "removed" | "unchanged" | "all";
export function filterFiles(files: FileRow[], f: Filter): FileRow[] {
  // a failed file must never hide behind a filter
  return files.filter((x) => (f === "all" ? true : f === "changed" ? x.change !== "unchanged" || x.state === "failed" : x.change === f));
}
export function groupFiles(files: FileRow[]): Group[] {
  const map = new Map<string, FileRow[]>();
  for (const f of files) { const d = dirOf(f.path); (map.get(d) ?? map.set(d, []).get(d)!).push(f); }
  return [...map.entries()].sort((a, b) => (a[0] === ROOT_DIR ? -1 : b[0] === ROOT_DIR ? 1 : a[0].localeCompare(b[0]))).map(([dir, fs]) => ({
    dir, files: fs.sort((a, b) => a.path.localeCompare(b.path)),
    done: fs.filter((x) => x.state === "installed" || x.state === "removed").length, failed: fs.filter((x) => x.state === "failed").length,
  }));
}
