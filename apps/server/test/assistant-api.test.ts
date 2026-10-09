import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Assistant, Memory, type LlmProvider } from "@juunibi/assistant";
import { createApp } from "../src/app";
import { AssistantSettingsStore } from "../src/assistant-settings";
import { Organizer, buildBrief } from "../src/organizer";
import { EvalHistory, EvalService } from "../src/evals";

const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } } as never;
let server: http.Server, base: string, dir: string, assistant: Assistant, memory: Memory, settings: AssistantSettingsStore, evals: EvalService;
const call = (p: string, method = "GET", body?: unknown) => fetch(base + p, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-aapi-"));
  memory = new Memory();
  const llm: LlmProvider = { chat: async (m) => ({ content: String(m.at(-1)?.content).includes("17") ? "391" : "Ответ с ключом sk-abcdef1234567890XYZ", toolCalls: [] }) };
  assistant = new Assistant({ llm, memory, log: quiet, prefs: () => ({ suggestions: "off", summaries: false }) });
  settings = new AssistantSettingsStore(path.join(dir, "s.json"), {});
  await settings.load();
  const organizer = new Organizer(path.join(dir, "o.json"), () => Date.parse("2026-10-09T05:00:00+03:00"));
  const history = new EvalHistory(path.join(dir, "e.json"));
  evals = new EvalService(history, { ask: () => async (q, signal) => { const r = await assistant.ask(q, "eval", signal, { history: [], ephemeral: true }); return { reply: r.reply, tools: r.tools }; }, model: () => "m", persona: () => "p" });
  server = createApp({
    assistant, memory, settings, organizer, evals, modules: () => [], configured: {},
    brief: async () => buildBrief({ now: Date.now(), reminders: organizer.listReminders(), notes: organizer.listNotes(), plansRunning: 0, memoryPending: 0, modulesFailed: [], updateAvailable: false }),
  });
  base = await new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
});
afterAll(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

describe("настройки помощницы", () => {
  it("значения по умолчанию, частичное обновление и валидация", async () => {
    const s = await (await call("/api/assistant/settings")).json();
    expect(s).toMatchObject({ embeddings: { enabled: true, model: "BAAI/bge-m3" }, suggestions: "smart", summaries: true, files: { root: "", allowWrite: false }, web: false, quickCommands: [] });
    const upd = await (await call("/api/assistant/settings", "POST", { suggestions: "rules", web: true })).json();
    expect(upd).toMatchObject({ suggestions: "rules", web: true, summaries: true });
    for (const bad of [{ suggestions: "всегда" }, { embeddings: { model: "bad model!" } }, { files: { root: "relative/path" } }, { files: { root: path.join(dir, "нет") } }, { web: "да" }, [], { quickCommands: [{ name: "память", text: "x" }] }, { quickCommands: [{ name: "a b", text: "x" }] }])
      expect((await call("/api/assistant/settings", "POST", bad)).status, JSON.stringify(bad)).toBe(400);
  });
  it("папка: нужна реальная, запись без папки невозможна, корень диска нельзя", async () => {
    const ok = await (await call("/api/assistant/settings", "POST", { files: { root: dir, allowWrite: true } })).json();
    expect(ok.files.allowWrite).toBe(true);
    expect((await call("/api/assistant/settings", "POST", { files: { root: "/" } })).status).toBe(400);
    const cleared = await (await call("/api/assistant/settings", "POST", { files: { root: "" } })).json();
    expect(cleared.files).toEqual({ root: "", allowWrite: false });
  });
  it("быстрые команды сохраняются в нормальном виде", async () => {
    const r = await (await call("/api/assistant/settings", "POST", { quickCommands: [{ name: "/Итоги", text: "Подведи итоги дня" }] })).json();
    expect(r.quickCommands).toEqual([{ name: "итоги", text: "Подведи итоги дня" }]);
  });
  it("проверка поиска по смыслу сообщает, что он не настроен", async () => {
    expect(await (await call("/api/assistant/embedding-test", "POST", {})).json()).toMatchObject({ ok: false });
  });
});

describe("память: закрепление, срок, экспорт и импорт", () => {
  it("закрепить, поставить срок, экспортировать, импортировать как предложения", async () => {
    const e = await (await call("/api/memory", "POST", { text: "Люблю чай", kind: "preference" })).json();
    expect((await call(`/api/memory/${e.id}/pin`, "POST", { pinned: true })).status).toBe(200);
    expect((await call(`/api/memory/${e.id}/pin`, "POST", { pinned: "да" })).status).toBe(400);
    expect((await call(`/api/memory/${e.id}/expiry`, "POST", { until: Date.now() + 86_400_000 })).status).toBe(200);
    expect((await call(`/api/memory/${e.id}/expiry`, "POST", { until: 5 })).status).toBe(400);
    expect((await call(`/api/memory/${e.id}/expiry`, "POST", { until: null })).status).toBe(200);
    const list = await (await call("/api/memory")).json();
    expect(list.find((x: { id: string }) => x.id === e.id)).toMatchObject({ pinned: true });
    const dump = await (await call("/api/memory/export")).json();
    expect(dump).toMatchObject({ app: "JUUNIBI", kind: "memory", version: 1 });
    expect(dump.entries.some((x: { text: string; pinned?: boolean }) => x.text === "Люблю чай" && x.pinned)).toBe(true);
    const imported = await (await call("/api/memory/import", "POST", { entries: [{ kind: "fact", text: "Живу в Казани" }, { kind: "fact", text: "Люблю чай" }, { kind: "fact", text: "пароль 123" }] })).json();
    expect(imported).toEqual({ added: 1, duplicates: 1, skipped: 1 });
    const pending = await (await call("/api/memory?status=pending")).json();
    expect(pending.map((x: { text: string }) => x.text)).toContain("Живу в Казани");
    expect((await call("/api/memory/import", "POST", { nope: 1 })).status).toBe(400);
  });
});

describe("заметки, напоминания и сводка", () => {
  it("полный круг через HTTP", async () => {
    const todo = await (await call("/api/organizer/notes", "POST", { kind: "todo", text: "Купить хлеб" })).json();
    expect((await call(`/api/organizer/notes/${todo.id}/done`, "POST", { done: true })).status).toBe(200);
    expect((await call(`/api/organizer/notes/${todo.id}/done`, "POST", { done: "x" })).status).toBe(400);
    const rem = await (await call("/api/organizer/reminders", "POST", { text: "Позвонить", at: "2026-10-10T10:00:00+03:00" })).json();
    expect((await call("/api/organizer/reminders", "POST", { text: "x", at: "завтра" })).status).toBe(400);
    const all = await (await call("/api/organizer")).json();
    expect(all.notes).toHaveLength(1); expect(all.reminders).toHaveLength(1);
    const brief = await (await call("/api/brief")).json();
    expect(brief).toMatchObject({ openTodos: { count: 0 }, attention: 0 });
    expect((await call(`/api/organizer/reminders/${rem.id}/dismiss`, "POST", {})).status).toBe(200);
    expect((await call(`/api/organizer/reminders/${rem.id}`, "DELETE")).status).toBe(200);
    expect((await call(`/api/organizer/reminders/${rem.id}`, "DELETE")).status).toBe(404);
    expect((await call(`/api/organizer/notes/${todo.id}`, "DELETE")).status).toBe(200);
    expect((await call("/api/organizer/неизвестно", "POST", {})).status).toBe(404);
  });
});

describe("качество и контрольные вопросы", () => {
  it("отчёт по оценкам и очищенная выгрузка набора", async () => {
    const r = await assistant.ask("мой ключ sk-abcdef1234567890XYZ", "s");
    await assistant.feedback(r.turnId, 1);
    const q = await (await call("/api/assistant/quality")).json();
    expect(q.totals).toMatchObject({ turns: 1, up: 1, satisfaction: 100 });
    expect(q.datasetReady).toBe(1);
    const clean = await (await call("/api/dataset")).text();
    expect(clean).not.toContain("sk-abcdef1234567890XYZ");
    expect(await (await call("/api/dataset?raw=1")).text()).toContain("sk-abcdef1234567890XYZ");
  });
  it("запуск проверки идёт в фоне, один за раз, результат попадает в историю, ходы не логируются", async () => {
    const turnsBefore = assistant.turnsSnapshot().length;
    const started = await call("/api/assistant/eval", "POST", {});
    expect(started.status).toBe(202);
    expect((await call("/api/assistant/eval", "POST", {})).status).toBe(409);
    await evals.idle();
    const s = await (await call("/api/assistant/eval")).json();
    expect(s).toMatchObject({ running: false, last: { total: 12 } });
    expect(s.last.results.find((x: { id: string }) => x.id === "math-1").passed).toBe(true);
    expect(s.history).toHaveLength(1);
    expect(assistant.turnsSnapshot().length).toBe(turnsBefore);
  });
});
