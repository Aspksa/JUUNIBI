import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Assistant, Memory, type LlmProvider, type LlmResponse } from "@juunibi/assistant";
import { defaultSettings, type AssistantSettings } from "./assistant-settings";
import { buildExtraTools, toolEnabled } from "./assistant-tools";
import { Organizer, buildBrief } from "./organizer";

const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } } as never;
async function setup(over: Partial<AssistantSettings> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-tools-"));
  const docs = path.join(dir, "docs"); await import("node:fs/promises").then((m) => m.mkdir(docs));
  await writeFile(path.join(docs, "план.txt"), "купить чай");
  const settings: AssistantSettings = { ...defaultSettings({}), files: { root: docs, allowWrite: true }, web: true, ...over };
  const organizer = new Organizer(path.join(dir, "org.json"), () => Date.parse("2026-10-09T05:00:00+03:00"));
  const tools = buildExtraTools({ settings: () => settings, organizer, backupDir: path.join(dir, "bk"), brief: async () => buildBrief({ now: Date.now(), reminders: [], notes: [], plansRunning: 0, memoryPending: 0, modulesFailed: [], updateAvailable: false }),
    fetcher: (async () => new Response(JSON.stringify({ query: { search: [{ title: "Чай", snippet: "напиток" }] } }))) as never,
    web: {
      search: async (q, cfg) => ({ provider: cfg.provider, results: [{ title: "Чай — Вики", url: "https://example.com/tea", snippet: String(q) }] }),
      read: async (url) => ({ url: String(url), title: "Чай", text: "Чай — напиток", truncated: false }),
    } });
  return { dir, docs, settings, organizer, tools, by: Object.fromEntries(tools.map((t) => [t.name, t])), done: () => rm(dir, { recursive: true, force: true }) };
}

describe("видимость инструментов зависит от настроек владельца", () => {
  it("файлы, запись и справочник включаются по отдельности", () => {
    const base = defaultSettings({});
    expect(["list_files", "read_file", "search_files", "write_file", "web_search", "web_open", "wiki_search", "wiki_read"].map((n) => toolEnabled(n, base))).toEqual([false, false, false, false, false, false, false, false]);
    const withFolder = { ...base, files: { root: "/x", allowWrite: false } };
    expect(["read_file", "write_file"].map((n) => toolEnabled(n, withFolder))).toEqual([true, false]);
    expect(toolEnabled("write_file", { ...withFolder, files: { root: "/x", allowWrite: true } })).toBe(true);
    for (const n of ["web_search", "web_open", "wiki_read"]) expect(toolEnabled(n, { ...base, web: true })).toBe(true);
    for (const n of ["list_notes", "add_note", "add_reminder", "daily_brief", "list_modules"]) expect(toolEnabled(n, base)).toBe(true);
  });
});

describe("инструменты", () => {
  it("уровни риска: чтение без подтверждения, изменения — write, запись файлов — danger с планом", async () => {
    const { by, done } = await setup();
    try {
      for (const n of ["list_files", "read_file", "search_files", "web_search", "web_open", "wiki_search", "wiki_read", "list_notes", "list_reminders", "daily_brief"]) expect(by[n]!.risk, n).toBe("read");
      for (const n of ["add_note", "complete_todo", "add_reminder", "cancel_reminder"]) expect(by[n]!.risk, n).toBe("write");
      expect(by.write_file!.risk).toBe("danger");
      expect(by.write_file!.actionPlan!.checks.length).toBeGreaterThan(2);
    } finally { await done(); }
  });
  it("чтение файлов работает в папке и не выходит из неё", async () => {
    const { by, done } = await setup();
    try {
      expect((await by.read_file!.run({ path: "план.txt" }) as { text: string }).text).toBe("купить чай");
      await expect(by.read_file!.run({ path: "../org.json" })).rejects.toThrow(/пределы/);
      await expect(by.read_file!.run({ path: ".env" })).rejects.toThrow(/закрыты/);
      expect((await by.search_files!.run({ query: "чай" }) as { hits: unknown[] }).hits).toHaveLength(1);
      expect((await by.list_files!.run({}) as { entries: { name: string }[] }).entries.map((e) => e.name)).toEqual(["план.txt"]);
    } finally { await done(); }
  });
  it("write_file пишет только в разрешённую папку и хранит резервную копию", async () => {
    const { by, docs, dir, done } = await setup();
    try {
      await by.write_file!.run({ path: "план.txt", content: "купить кофе" });
      expect(await readFile(path.join(docs, "план.txt"), "utf8")).toBe("купить кофе");
      const { readdir } = await import("node:fs/promises");
      expect(await readdir(path.join(dir, "bk"))).toHaveLength(1);
      await expect(by.write_file!.run({ path: "run.sh", content: "rm -rf /" })).rejects.toThrow();
    } finally { await done(); }
  });
  it("без выбранной папки файловые инструменты отвечают понятной ошибкой", async () => {
    const { by, done } = await setup({ files: { root: "", allowWrite: false } });
    try { await expect(by.read_file!.run({ path: "a.txt" })).rejects.toThrow(/не настроен/); } finally { await done(); }
  });
  it("справочник возвращает ссылку на источник; статья не найдена — понятный ответ", async () => {
    const { by, done } = await setup();
    try {
      const r = await by.wiki_search!.run({ query: "чай" }) as { title: string; url: string }[];
      expect(r[0]).toMatchObject({ title: "Чай" });
      expect(r[0]!.url).toMatch(/^https:\/\/ru\.wikipedia\.org\/wiki\//);
    } finally { await done(); }
  });
  it("интернет: поиск открывает доступ к найденным страницам, чужие адреса не открываются", async () => {
    const { by, done } = await setup();
    try {
      await expect(by.web_open!.run({ url: "https://example.com/tea" })).resolves.toMatchObject({ error: expect.stringMatching(/нельзя/) });
      const found = await by.web_search!.run({ query: "чай" }) as { provider: string; results: { url: string }[] };
      expect(found).toMatchObject({ provider: "duckduckgo", results: [{ url: "https://example.com/tea" }] });
      await expect(by.web_open!.run({ url: "https://example.com/tea#part" })).resolves.toMatchObject({ text: "Чай — напиток" });
      await expect(by.web_open!.run({ url: "https://evil.example/?secret=1" })).resolves.toMatchObject({ error: expect.any(String) });
    } finally { await done(); }
  });
  it("повторяющееся напоминание через инструмент", async () => {
    const { by, organizer, done } = await setup();
    try {
      await by.add_reminder!.run({ text: "Пить воду", at: "2026-10-10T10:00:00+03:00", repeat: "daily" });
      expect(organizer.listReminders()[0]!.repeat).toBe("daily");
      expect(await by.list_reminders!.run({})).toEqual([expect.objectContaining({ repeat: "daily" })]);
      await expect(by.add_reminder!.run({ text: "x", at: "2026-10-10T10:00:00+03:00", repeat: "monthly" })).rejects.toThrow(/Повтор/);
    } finally { await done(); }
  });
  it("заметки, дела и напоминания через инструменты", async () => {
    const { by, organizer, done } = await setup();
    try {
      const note = await by.add_note!.run({ text: "Купить хлеб", kind: "todo" }) as { id: string };
      expect(await by.list_notes!.run({})).toEqual([{ id: note.id, kind: "todo", text: "Купить хлеб", done: false }]);
      await by.complete_todo!.run({ id: note.id });
      expect(organizer.listNotes()[0]!.done).toBe(true);
      const r = await by.add_reminder!.run({ text: "Позвонить", at: "2026-10-10T10:00:00+03:00" }) as { id: string };
      expect((await by.list_reminders!.run({}) as unknown[])).toHaveLength(1);
      await by.cancel_reminder!.run({ id: r.id });
      await expect(by.add_reminder!.run({ text: "x", at: "завтра" })).rejects.toThrow(/ISO/);
    } finally { await done(); }
  });
});

describe("через ассистента: подтверждения и политика", () => {
  const call = (name: string, args: object): LlmResponse => ({ content: null, toolCalls: [{ id: "c1", name, arguments: JSON.stringify(args) }] });
  it("запись файла и добавление напоминания без подтверждения владельца отклоняются, с подтверждением выполняются", async () => {
    const { tools, docs, organizer, done } = await setup();
    try {
      const run = async (toolCall: LlmResponse, approve?: () => boolean) => {
        const replies = [toolCall, { content: "готово", toolCalls: [] } as LlmResponse];
        const llm: LlmProvider = { chat: async () => replies.shift()! };
        const a = new Assistant({ llm, memory: new Memory(), log: quiet, ...(approve ? { approve } : {}) });
        for (const t of tools) a.tools.register(t);
        const events: { status?: string }[] = [];
        await a.ask("сделай", "s", undefined, { onEvent: (e) => { if (e.type === "tool" && e.phase === "end") events.push(e); } });
        return events[0]!.status;
      };
      expect(await run(call("write_file", { path: "x.txt", content: "1" }))).toBe("denied");
      await expect(readFile(path.join(docs, "x.txt"), "utf8")).rejects.toThrow();
      expect(await run(call("write_file", { path: "x.txt", content: "1" }), () => true)).toBe("ok");
      expect(await readFile(path.join(docs, "x.txt"), "utf8")).toBe("1");
      expect(await run(call("add_reminder", { text: "тест", at: "2026-10-10T10:00:00+03:00" }))).toBe("denied");
      expect(organizer.listReminders()).toHaveLength(0);
      expect(await run(call("add_reminder", { text: "тест", at: "2026-10-10T10:00:00+03:00" }), () => true)).toBe("ok");
      expect(organizer.listReminders()).toHaveLength(1);
      // read-инструменты идут без подтверждения
      expect(await run(call("read_file", { path: "план.txt" }))).toBe("ok");
    } finally { await done(); }
  });
  it("toolPolicy скрывает выключенные инструменты от модели", async () => {
    const { tools, settings, done } = await setup({ files: { root: "", allowWrite: false }, web: false });
    try {
      let offered: string[] = [];
      const llm: LlmProvider = { chat: async (_m, o) => { offered = (o?.tools ?? []).map((t) => t.name); return { content: "ок", toolCalls: [] }; } };
      const a = new Assistant({ llm, memory: new Memory(), log: quiet, toolPolicy: (n) => toolEnabled(n, settings) });
      for (const t of tools) a.tools.register(t);
      await a.ask("привет");
      expect(offered).not.toContain("read_file"); expect(offered).not.toContain("write_file"); expect(offered).not.toContain("web_search");
      expect(offered).toContain("add_note"); expect(offered).toContain("daily_brief");
    } finally { await done(); }
  });
});
void vi;
