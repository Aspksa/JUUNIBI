import { describe, expect, it } from "vitest";
import type { AssistantSettings } from "../src/api";
import { fillPlaceholders } from "../src/chat/helpers";
import { instructionsPrompt } from "../../server/src/assistant-settings";
import { BACKUP_KIND, instructionsPreview, makeBackup, matches, move, parseBackup, sectionHealth, type CheckResult } from "../src/pages/settings-parts";

const cfg: AssistantSettings = {
  embeddings: { enabled: true, model: "BAAI/bge-m3" }, chat: { model: "m1", fallbackModel: "", reasoning: true }, suggestions: "smart", summaries: true,
  files: { root: "C:\\notes", allowWrite: true }, web: true, webSearch: { provider: "duckduckgo", braveKeySet: false }, instructions: { about: "я", style: "коротко" }, quickCommands: [{ name: "итоги", text: "Итоги {дата}" }],
};
const DAY = 86_400_000;

describe("sectionHealth", () => {
  const base = { status: { assistant: true }, cfg, checks: [] as CheckResult[], chats: 0, lastBackup: 0, now: 100 * DAY };
  it("is green when everything is set up", () => {
    const h = sectionHealth(base);
    expect(h.conn?.tone).toBe("ok"); expect(h.model?.tone).toBe("ok"); expect(h.memory?.tone).toBe("ok"); expect(h.tools?.tone).toBe("ok");
    expect(h.data).toBeUndefined();
  });
  it("asks for attention when the key is missing or a check failed", () => {
    const fail = (id: CheckResult["id"]): CheckResult => ({ id, title: id, status: "fail", detail: "503" });
    const h = sectionHealth({ ...base, status: { assistant: false }, checks: [fail("fallback"), fail("embeddings"), fail("web")] });
    expect(h.conn).toEqual({ tone: "warn", why: "Не указан ключ Cloud.ru" });
    expect(h.model?.tone).toBe("warn"); expect(h.memory?.why).toContain("503"); expect(h.tools?.tone).toBe("warn");
  });
  it("ignores a failed check of a feature that is switched off", () => {
    const h = sectionHealth({ ...base, cfg: { ...cfg, web: false, embeddings: { ...cfg.embeddings, enabled: false } }, checks: [{ id: "web", title: "", status: "fail", detail: "" }, { id: "embeddings", title: "", status: "fail", detail: "" }] });
    expect(h.tools?.tone).toBe("ok"); expect(h.memory?.tone).toBe("ok");
  });
  it("wants a Brave key and a fresh backup", () => {
    const h = sectionHealth({ ...base, cfg: { ...cfg, webSearch: { provider: "brave", braveKeySet: false } }, chats: 3, lastBackup: 50 * DAY });
    expect(h.tools?.why).toMatch(/Brave/);
    expect(h.data?.tone).toBe("warn");
    expect(sectionHealth({ ...base, chats: 3, lastBackup: 95 * DAY }).data?.tone).toBe("ok");
    expect(sectionHealth({ ...base, chats: 3 }).data?.why).toMatch(/ещё не было/);
  });
});

describe("backup", () => {
  it("round-trips without the folder and only with known preferences", () => {
    const b = makeBackup({ chats: [{ id: "c" }], settings: cfg, memory: { items: [1] }, prefs: { "juunibi:ui:v3": "{}", "juunibi:nav:v1": null, "other": "x" }, now: new Date("2026-10-10T12:00:00Z") });
    expect(b.kind).toBe(BACKUP_KIND);
    expect(b.settings).not.toHaveProperty("files");
    expect(b.settings).not.toHaveProperty("webSearch");
    expect(b.settings?.quickCommands).toEqual(cfg.quickCommands);
    expect(b.prefs).toEqual({ "juunibi:ui:v3": "{}" });
    const p = parseBackup(JSON.parse(JSON.stringify(b)));
    expect(p.ok && p.backup.chats).toEqual([{ id: "c" }]);
    expect(p.ok && p.backup.memory).toEqual({ items: [1] });
  });
  it("accepts an old chats-only export and refuses anything else", () => {
    const old = parseBackup([{ id: "a" }]);
    expect(old.ok && old.backup.chats.length).toBe(1);
    expect(parseBackup({ hello: 1 }).ok).toBe(false);
    expect(parseBackup({ kind: BACKUP_KIND, version: 2 })).toEqual({ ok: false, error: expect.stringMatching(/новой версией/) });
    const odd = parseBackup({ kind: BACKUP_KIND, version: 1, chats: "x", settings: [1], prefs: { "juunibi:ui:v3": 5, "evil": "x" } });
    expect(odd.ok && odd.backup).toMatchObject({ chats: [], settings: null, prefs: {} });
  });
});

describe("helpers", () => {
  it("matches every word, ignoring case and ё", () => {
    expect(matches("тёмная ТЕМА", "Тема: светлая, темная")).toBe(true);
    expect(matches("папка запись", "Доступ к файлам: папка")).toBe(false);
    expect(matches("  ", "x")).toBe(false);
  });
  it("moves a quick command", () => {
    expect(move(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(move(["a"], 0, 5)).toEqual(["a"]);
  });
  it("previews exactly what the server sends", () => {
    for (const [about, style] of [["я Аня", ""], ["", "коротко"], ["я", "на ты"], ["", ""]] as const)
      expect(instructionsPreview(about, style)).toBe(instructionsPrompt({ ...cfg, webSearch: { provider: "duckduckgo", braveKey: "" }, instructions: { about, style } }));
  });
  it("fills placeholders of quick commands", () => {
    const now = new Date(2026, 9, 10, 9, 5);
    expect(fillPlaceholders("Итоги {дата} в {время}, {день}: {буфер}", { now, clipboard: "  текст " })).toBe("Итоги 10.10.2026 в 09:05, суббота: текст");
    expect(fillPlaceholders("{Дата} {неизвестно}", { now })).toBe("10.10.2026 {неизвестно}");
  });
});
