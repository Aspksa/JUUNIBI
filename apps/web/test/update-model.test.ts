import { describe, expect, it } from "vitest";
import type { UpdateEvent, UpdateStatus } from "../src/api";
import { buildUpdateModel, filterFiles, formatBytes, groupFiles } from "../src/pages/update-model";

let n = 0;
const ev = (type: string, extra: Partial<UpdateEvent> & Record<string, unknown> = {}): UpdateEvent =>
  ({ event_id: "e" + n++, type, timestamp: new Date(2026, 9, 8, 12, 0, n).toISOString(), operation_id: "op", relative_path: "", status: "x", ...extra }) as UpdateEvent;
const SHA_A = "a".repeat(40), SHA_B = "b".repeat(40);
const status = (o: Partial<UpdateStatus> = {}): UpdateStatus => ({ phase: "idle", percent: 0, downloadedFiles: 0, totalFiles: 0, downloadedBytes: 0, totalBytes: 0, message: "", localVersion: SHA_A,
  latest: { sha: SHA_B, version: SHA_B.slice(0, 8), description: "Fix things", date: "" }, ...o });
const files = [{ path: "apps/a.ts", change_type: "modified", size: 10 }, { path: "apps/b.ts", change_type: "added", size: 20 }, { path: "docs/old.md", change_type: "removed", size: 0 }, { path: "README.md", change_type: "unchanged", size: 5 }];
const manifest = () => ev("manifest_ready", { files });

describe("headline and action follow the real phase", () => {
  it("not checked yet", () => {
    const m = buildUpdateModel(status({ latest: null }), []);
    expect(m).toMatchObject({ tone: "neutral", action: "check", headline: "Проверьте наличие обновлений" });
  });
  it("new version available -> primary action is download, description is shown", () => {
    expect(buildUpdateModel(status(), [])).toMatchObject({ tone: "info", action: "download", headline: "Доступна новая версия", sub: "Fix things" });
  });
  it("up to date", () => {
    expect(buildUpdateModel(status({ localVersion: SHA_B }), [])).toMatchObject({ tone: "ok", headline: "У вас последняя версия", action: "check" });
  });
  it("downloading shows real counts and bytes, and blocks actions", () => {
    const m = buildUpdateModel(status({ phase: "downloading", downloadedFiles: 3, totalFiles: 10, downloadedBytes: 2048, totalBytes: 10240, percent: 20 }), []);
    expect(m).toMatchObject({ tone: "busy", action: "busy", headline: "Скачиваем обновление" });
    expect(m.sub).toBe("3 из 10 файлов · 2.0 КБ из 10 КБ");
  });
  it("testing and ready", () => {
    expect(buildUpdateModel(status({ phase: "testing" }), [])).toMatchObject({ tone: "busy", headline: "Проверяем обновление" });
    expect(buildUpdateModel(status({ phase: "ready" }), [])).toMatchObject({ tone: "ok", action: "restart", headline: "Обновление готово к установке" });
  });
  it("error carries the server message and offers a retry", () => {
    expect(buildUpdateModel(status({ phase: "error", error: "npm test упал" }), [])).toMatchObject({ tone: "danger", action: "download", sub: "npm test упал" });
  });
  it("no status yet -> busy placeholder, never a fake state", () => {
    expect(buildUpdateModel(null, [])).toMatchObject({ tone: "busy", action: "busy" });
  });
});

describe("pipeline steps", () => {
  const byId = (m: ReturnType<typeof buildUpdateModel>) => Object.fromEntries(m.steps.map((s) => [s.id, s.status]));
  it("idle with a known version: only the check is done", () => {
    expect(byId(buildUpdateModel(status(), []))).toEqual({ check: "done", download: "todo", verify: "todo", tests: "todo", ready: "todo", install: "todo" });
  });
  it("downloading: download active with the real percent; verify becomes active once a file is verified", () => {
    const u = status({ phase: "downloading", downloadedFiles: 1, totalFiles: 4, percent: 25 });
    let m = buildUpdateModel(u, [manifest()]);
    expect(byId(m).download).toBe("active"); expect(m.steps[1]!.progress).toBe(25); expect(byId(m).verify).toBe("todo");
    m = buildUpdateModel(u, [manifest(), ev("file_verify_done", { relative_path: "apps/a.ts" })]);
    expect(byId(m).verify).toBe("active"); expect(m.steps[2]!.detail).toBe("1 из 4 по хешам");
  });
  it("testing: download/verify done, tests active", () => {
    expect(byId(buildUpdateModel(status({ phase: "testing", totalFiles: 4, downloadedFiles: 4 }), []))).toMatchObject({ download: "done", verify: "done", tests: "active", ready: "todo" });
  });
  it("ready: everything before installation is done", () => {
    expect(byId(buildUpdateModel(status({ phase: "ready" }), []))).toMatchObject({ download: "done", verify: "done", tests: "done", ready: "done", install: "todo" });
  });
  it("error during download vs during tests marks the right step", () => {
    expect(byId(buildUpdateModel(status({ phase: "error", totalFiles: 10, downloadedFiles: 3 }), [])).download).toBe("error");
    const t = byId(buildUpdateModel(status({ phase: "error", totalFiles: 10, downloadedFiles: 10 }), []));
    expect(t.tests).toBe("error"); expect(t.download).toBe("todo");
  });
});

describe("file list from real events", () => {
  it("counts changes and resolves per-file state (failed > installed > verified > downloaded)", () => {
    const m = buildUpdateModel(status({ phase: "ready" }), [manifest(),
      ev("file_download_done", { relative_path: "apps/a.ts" }), ev("file_verify_done", { relative_path: "apps/a.ts" }),
      ev("file_download_done", { relative_path: "apps/b.ts" }),
      ev("file_install_done", { relative_path: "apps/a.ts" }), ev("file_install_failed", { relative_path: "apps/b.ts", message: "x" }),
      ev("file_remove_done", { relative_path: "docs/old.md" })]);
    expect(m.counts).toEqual({ added: 1, modified: 1, removed: 1, unchanged: 1 });
    const st = Object.fromEntries(m.files.map((f) => [f.path, f.state]));
    expect(st).toEqual({ "apps/a.ts": "installed", "apps/b.ts": "failed", "docs/old.md": "removed", "README.md": "waiting" });
  });
  it("marks the file being downloaded right now, only while downloading", () => {
    const evs = [manifest(), ev("download_started", { relative_path: "apps/b.ts" })];
    expect(buildUpdateModel(status({ phase: "downloading" }), evs).files.find((f) => f.path === "apps/b.ts")!.state).toBe("downloading");
    expect(buildUpdateModel(status({ phase: "idle" }), evs).files.find((f) => f.path === "apps/b.ts")!.state).toBe("waiting");
  });
  it("only events of the latest manifest count; duplicates are ignored", () => {
    const old = ev("file_download_done", { relative_path: "apps/a.ts" });
    const m = buildUpdateModel(status(), [old, manifest(), old]);
    expect(m.files.find((f) => f.path === "apps/a.ts")!.state).toBe("waiting");
  });
  it("tracks the file currently moving for the lane", () => {
    expect(buildUpdateModel(status({ phase: "downloading" }), [manifest(), ev("download_started", { relative_path: "apps/b.ts" })]).current).toBe("apps/b.ts");
  });
});

describe("installation result (launcher events)", () => {
  it("fresh completed install matching the local version, with a healthy check", () => {
    const m = buildUpdateModel(status({ localVersion: SHA_B }), [manifest(), ev("update_prepared"), ev("health_check_done", { status: "healthy" }), ev("update_completed", { sha: SHA_B, backup_relative_path: ".updates/backups/x" })]);
    expect(m.installed).toMatchObject({ ok: true, healthy: true, sha: SHA_B, backup: ".updates/backups/x" });
    expect(m.steps.find((s) => s.id === "install")!.status).toBe("done");
    expect(m.health).toEqual({ ok: true, message: "" });
  });
  it("a completed event for an older sha is not shown as the current state", () => {
    expect(buildUpdateModel(status({ localVersion: SHA_A }), [ev("update_prepared"), ev("update_completed", { sha: SHA_B })]).installed).toBeNull();
  });
  it("failed health check -> rollback is reported with the reason", () => {
    const m = buildUpdateModel(status(), [ev("update_prepared"), ev("health_check_done", { status: "failed", message: "не запускается" }), ev("update_failed", { message: "не запускается" }), ev("rollback_done")]);
    expect(m.installed).toMatchObject({ ok: false, message: "не запускается" });
    expect(m.steps.find((s) => s.id === "install")!.status).toBe("error");
  });
});

describe("grouping and filters", () => {
  const rows = buildUpdateModel(status(), [manifest()]).files;
  it("filters by change type; 'changed' hides unchanged", () => {
    expect(filterFiles(rows, "changed").map((f) => f.path)).toEqual(["apps/a.ts", "apps/b.ts", "docs/old.md"]);
    expect(filterFiles(rows, "added").map((f) => f.path)).toEqual(["apps/b.ts"]);
    expect(filterFiles(rows, "all")).toHaveLength(4);
  });
  it("a failed file stays visible in the default 'changed' view even if its change type is 'unchanged'", () => {
    const m = buildUpdateModel(status(), [manifest(), ev("file_install_failed", { relative_path: "README.md" })]);
    expect(filterFiles(m.files, "changed").map((f) => f.path)).toContain("README.md");
    expect(filterFiles(m.files, "added").map((f) => f.path)).not.toContain("README.md");
  });
  it("groups by folder, sorted, with root files under a readable name", () => {
    const g = groupFiles(rows);
    expect(g.map((x) => x.dir)).toEqual(["Корень проекта", "apps", "docs"]);
    expect(g[1]!.files.map((f) => f.path)).toEqual(["apps/a.ts", "apps/b.ts"]);
  });
  it("formatBytes", () => { expect(formatBytes(5)).toBe("5 Б"); expect(formatBytes(1536)).toBe("1.5 КБ"); expect(formatBytes(5 * 1048576)).toBe("5.0 МБ"); });
});
