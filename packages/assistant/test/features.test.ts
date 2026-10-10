import { describe, expect, it, vi } from "vitest";
import { Assistant, Memory, MemoryAdapter, nowLine, type EmbeddingProvider, type LlmProvider, type LlmResponse, type Message } from "../src";

const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } } as never;

describe("память: закрепление, экспорт и импорт", () => {
  it("закреплённая запись выше в выдаче и вытесняется последней", async () => {
    const m = new Memory();
    const plain = await m.add("fact", "чай любимый напиток", "active");
    const pinned = await m.add("fact", "чай хранится в шкафу", "active");
    await m.setPinned(pinned.id, true);
    expect((await m.search("чай"))[0]!.id).toBe(pinned.id);
    expect(plain.id).not.toBe(pinned.id);
    await m.setPinned(pinned.id, false);
    expect((await m.list()).find((e) => e.id === pinned.id)!.pinned).toBeUndefined();
    expect(await m.setPinned("нет-такого", true)).toBe(false);
  });
  it("при переполнении закреплённые записи переживают остальные", async () => {
    const dump = Array.from({ length: 2000 }, (_, i) => ({ id: "id" + i, kind: "fact", text: "запись " + i, status: "active", score: 0, createdAt: 1000 + i, ...(i === 0 ? { pinned: true } : {}) }));
    const m = new Memory({ load: async () => JSON.stringify(dump), save: async () => {} });
    await m.add("fact", "совсем новая запись", "pending");
    const all = await m.list();
    expect(all).toHaveLength(2000);
    expect(all.some((e) => e.id === "id0")).toBe(true);
  });
  it("экспорт не содержит служебного, импорт всегда создаёт предложения", async () => {
    const a = new Memory();
    const e1 = await a.add("preference", "Я предпочитаю короткие ответы", "active");
    await a.setPinned(e1.id, true);
    await a.add("fact", "Живу в Казани", "pending");
    const dump = await a.exportData();
    expect(dump).toMatchObject({ app: "JUUNIBI", kind: "memory", version: 1 });
    expect(JSON.stringify(dump)).not.toContain("score");
    const b = new Memory();
    await b.add("fact", "Живу в Казани", "active");
    const r = await b.importData(JSON.parse(JSON.stringify(dump)));
    expect(r).toEqual({ added: 1, duplicates: 1, skipped: 0 });
    const pending = await b.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.pinned).toBeUndefined();
    expect(await b.list("active")).toHaveLength(1); // импорт не активирует ничего
  });
  it("импорт пропускает секреты и мусор, отвергает чужой формат и слишком большие файлы", async () => {
    const m = new Memory();
    const r = await m.importData({ entries: [{ kind: "fact", text: "мой пароль 12345" }, { kind: "x", text: "что-то" }, { kind: "fact", text: "" }, { kind: "fact", text: "номер 1234 5678 9012" }, { kind: "fact", text: "x".repeat(600) }, { kind: "lesson", text: "Отвечать кратко" }] });
    expect(r).toEqual({ added: 1, duplicates: 0, skipped: 5 });
    await expect(m.importData("строка")).rejects.toMatchObject({ status: 400 });
    await expect(m.importData({ entries: Array.from({ length: 501 }, () => ({ kind: "fact", text: "a b c" })) })).rejects.toMatchObject({ status: 400 });
  });
  it("срок записи из импорта принимается только будущий", async () => {
    const m = new Memory();
    m.setClock(() => 1_000);
    await m.importData([{ kind: "fact", text: "Срок в будущем", expiresAt: 5_000 }, { kind: "fact", text: "Срок в прошлом", expiresAt: 10 }]);
    const list = await m.list("pending");
    expect(list.find((e) => e.text === "Срок в будущем")!.expiresAt).toBe(5_000);
    expect(list.find((e) => e.text === "Срок в прошлом")!.expiresAt).toBeUndefined();
  });
});

describe("поиск по смыслу: защита от зависания", () => {
  const failing: EmbeddingProvider = { embed: vi.fn(async () => { throw new Error("модель не найдена"); }) };
  it("после трёх сбоев подряд поиск по смыслу пропускается на время, ответы идут по словам", async () => {
    let t = 1_000_000;
    const m = new Memory();
    m.setClock(() => t);
    await m.add("fact", "кофе без сахара", "active");
    m.setEmbeddingProvider(failing);
    for (let i = 0; i < 3; i++) expect((await m.searchHybrid("кофе")).map((e) => e.text)).toEqual(["кофе без сахара"]);
    expect(m.embeddingDiagnostics()).toMatchObject({ failures: 3, paused: true, mode: "lexical" });
    const calls = (failing.embed as ReturnType<typeof vi.fn>).mock.calls.length;
    await m.searchHybrid("кофе");
    expect((failing.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls); // пауза: к модели не ходили
    t += Memory.BREAKER_PAUSE_MS + 1;
    expect(m.embeddingDiagnostics().paused).toBe(false);
  });
  it("probeEmbedding сообщает размерность и снимает паузу при успехе", async () => {
    const m = new Memory();
    expect(await m.probeEmbedding()).toMatchObject({ ok: false });
    m.setEmbeddingProvider({ embed: async () => [0.1, 0.2, 0.3] });
    expect(await m.probeEmbedding()).toMatchObject({ ok: true, dims: 3 });
    m.setEmbeddingProvider({ embed: async () => { throw new Error("401"); } });
    expect(await m.probeEmbedding()).toMatchObject({ ok: false, error: "401" });
  });
});

describe("автопредложения «запомнить»", () => {
  const cases: [string, string, "fact" | "preference"][] = [
    ["Меня зовут Анна", "Меня зовут Анна", "fact"],
    ["Я живу в Казани", "Я живу в Казани", "fact"],
    ["Имей в виду, что я сплю до десяти", "я сплю до десяти", "fact"],
    ["Не забудь: завтра у сына праздник", "завтра у сына праздник", "fact"],
    ["Называй меня Аней", "Называй меня Аней", "preference"],
    ["Всегда отвечай коротко и по делу", "Всегда отвечай коротко и по делу", "preference"],
    ["Мне не нравятся длинные вступления", "Мне не нравятся длинные вступления", "preference"],
  ];
  for (const [input, text, kind] of cases) it(`«${input}» → предложение (${kind}), не активная запись`, async () => {
    const m = new Memory();
    const r = await m.suggestFromUserText(input);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ text, kind, status: "pending" });
    expect(await m.list("active")).toHaveLength(0);
  });
  it("секреты и вопросы по-прежнему не предлагаются", async () => {
    const m = new Memory();
    for (const t of ["Меня зовут Анна, пароль 1234567", "Я живу в Казани?", "Запомни мой api key abc", "Привет"]) expect(await m.suggestFromUserText(t)).toEqual([]);
  });
});

function scripted(reply = "ок") {
  const seen: Message[][] = [];
  const llm: LlmProvider = { chat: async (m) => { seen.push(structuredClone(m)); return { content: reply, toolCalls: [] }; } };
  return { llm, seen };
}
const history = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `сообщение ${i}` }));

describe("настройки предложений", () => {
  it("off — ничего не предлагает, rules — только по явным фразам, smart — ещё и спрашивает модель", async () => {
    for (const [mode, expectedModelCalls] of [["off", 1], ["rules", 1], ["smart", 2]] as const) {
      const { llm, seen } = scripted(JSON.stringify({}));
      const memory = new Memory();
      const a = new Assistant({ llm, memory, log: quiet, prefs: () => ({ suggestions: mode, summaries: false }) });
      await a.ask("Я люблю гулять по вечерам в парке");
      await a.idle();
      expect(seen.length).toBe(expectedModelCalls);
    }
    const memory = new Memory();
    const a = new Assistant({ llm: scripted().llm, memory, log: quiet, prefs: () => ({ suggestions: "off", summaries: false }) });
    await a.ask("Запомни: кофе без сахара");
    expect(await memory.list()).toEqual([]);
    const b = new Assistant({ llm: scripted().llm, memory, log: quiet, prefs: () => ({ suggestions: "rules", summaries: false }) });
    await b.ask("Запомни: кофе без сахара");
    await b.idle();
    expect((await memory.list("pending")).map((e) => e.text)).toEqual(["кофе без сахара"]);
  });
});

describe("сводка старых сообщений", () => {
  it("модель видит последние 20 сообщений дословно, а раннее — в сводке со следующего хода", async () => {
    const calls: Message[][] = [];
    const llm: LlmProvider = { chat: async (m) => {
      calls.push(structuredClone(m));
      const isSummary = String(m[0]?.content).startsWith("Ты ведёшь краткое содержание");
      return { content: isSummary ? "Пользователь обсуждал сообщения 0–29." : "ответ", toolCalls: [] };
    } };
    const store = new MemoryAdapter();
    const a = new Assistant({ llm, memory: new Memory(), log: quiet, prefs: () => ({ suggestions: "off", summaries: true }), summariesStore: store });
    const h = history(50);
    await a.ask("дальше", "s1", undefined, { history: h });
    await a.idle();
    expect(calls.filter((c) => String(c[0]?.content).startsWith("Ты ведёшь"))).toHaveLength(1);
    const first = calls.find((c) => !String(c[0]?.content).startsWith("Ты ведёшь"))!;
    expect(first.map((m) => m.content).join("\n")).not.toContain("Краткое содержание"); // в первый ход сводки ещё нет
    expect(first.filter((m) => m.role !== "system")).toHaveLength(21); // 20 из истории + вопрос
    calls.length = 0;
    await a.ask("и ещё", "s1", undefined, { history: h });
    const second = calls[0]!;
    expect(String(second[0]!.content)).toContain("Краткое содержание");
    expect(String(second[0]!.content)).toContain("Пользователь обсуждал сообщения 0–29.");
    expect(JSON.parse((await store.load())!)).toBeTypeOf("object");
  });
  it("без роста истории повторно не вызывает модель; рост на 4+ сообщений — обновляет", async () => {
    let summaries = 0;
    const llm: LlmProvider = { chat: async (m) => { if (String(m[0]?.content).startsWith("Ты ведёшь")) summaries++; return { content: "сводка", toolCalls: [] }; } };
    const a = new Assistant({ llm, memory: new Memory(), log: quiet, prefs: () => ({ suggestions: "off", summaries: true }) });
    await a.ask("x", "s", undefined, { history: history(40) }); await a.idle();
    await a.ask("x", "s", undefined, { history: history(40) }); await a.idle();
    expect(summaries).toBe(1);
    await a.ask("x", "s", undefined, { history: history(46) }); await a.idle();
    expect(summaries).toBe(2);
  });
  it("короткий разговор и выключенная настройка не вызывают сводку", async () => {
    let summaries = 0;
    const llm: LlmProvider = { chat: async (m) => { if (String(m[0]?.content).startsWith("Ты ведёшь")) summaries++; return { content: "ок", toolCalls: [] }; } };
    const a = new Assistant({ llm, memory: new Memory(), log: quiet, prefs: () => ({ suggestions: "off", summaries: true }) });
    await a.ask("x", "s", undefined, { history: history(22) }); await a.idle();
    const off = new Assistant({ llm, memory: new Memory(), log: quiet, prefs: () => ({ suggestions: "off", summaries: false }) });
    await off.ask("x", "s", undefined, { history: history(80) }); await off.idle();
    expect(summaries).toBe(0);
  });
  it("сбой модели при сводке не ломает ответ", async () => {
    const llm: LlmProvider = { chat: async (m) => { if (String(m[0]?.content).startsWith("Ты ведёшь")) throw new Error("сеть"); return { content: "ответ", toolCalls: [] }; } };
    const a = new Assistant({ llm, memory: new Memory(), log: quiet, prefs: () => ({ suggestions: "off", summaries: true }) });
    expect((await a.ask("x", "s", undefined, { history: history(40) })).reply).toBe("ответ");
    await a.idle();
  });
  it("разные разговоры в одной сессии не смешивают сводки", async () => {
    const mk = (tag: string) => history(40).map((m, i) => ({ ...m, content: i === 0 ? tag : m.content }));
    const seen: string[] = [];
    const probe = new Assistant({ llm: { chat: async (m) => { if (!String(m[0]?.content).startsWith("Ты ведёшь")) seen.push(String(m[0]!.content)); return { content: "сводка: " + tagOf(m), toolCalls: [] }; } }, memory: new Memory(), log: quiet, prefs: () => ({ suggestions: "off", summaries: true }) });
    function tagOf(m: Message[]) { try { return String(JSON.parse(String(m[1]!.content)).messages[0].content); } catch { return ""; } }
    await probe.ask("x", "default", undefined, { history: mk("тема А") }); await probe.idle();
    await probe.ask("x", "default", undefined, { history: mk("тема Б") }); await probe.idle();
    await probe.ask("y", "default", undefined, { history: mk("тема А") });
    await probe.ask("y", "default", undefined, { history: mk("тема Б") });
    expect(seen[2]).toContain("сводка: тема А");
    expect(seen[3]).toContain("сводка: тема Б");
  });
});

describe("текущее время в промпте", () => {
  it("nowLine содержит день недели, дату, время и пояс", () => {
    const line = nowLine(new Date(2026, 9, 9, 5, 30));
    expect(line).toMatch(/^Сейчас: .*пятниц.*9 октября 2026.*05:30 \(UTC[+-]\d\d:\d\d\)\.$/);
  });
  it("попадает в системное сообщение", async () => {
    const { llm, seen } = scripted();
    const a = new Assistant({ llm, memory: new Memory(), log: quiet, now: () => new Date(2026, 9, 9, 5, 30) });
    await a.ask("привет");
    expect(String(seen[0]![0]!.content)).toContain("Сейчас:");
  });
});

import { redactSensitive, hadSensitive } from "../src";
describe("очистка данных для обучения", () => {
  it("маскирует ключи, токены, почту, телефоны и значения после «пароль»", () => {
    const text = "Мой ключ sk-abcdef1234567890XYZ, почта anna@example.com, телефон +7 (912) 345-67-89, пароль: hunter2, Bearer abc.def.ghi12345";
    const out = redactSensitive(text);
    for (const secret of ["sk-abcdef1234567890XYZ", "anna@example.com", "912) 345-67-89", "hunter2", "abc.def.ghi12345"]) expect(out).not.toContain(secret);
    expect(out).toContain("[ключ]"); expect(out).toContain("[почта]"); expect(out).toContain("[номер]"); expect(out).toContain("[скрыто]");
    expect(hadSensitive(text)).toBe(true);
  });
  it("обычный текст не меняется", () => {
    const t = "Расскажи про лису и 12 способов заварить чай";
    expect(redactSensitive(t)).toBe(t);
    expect(hadSensitive(t)).toBe(false);
  });
  it("выгрузка набора для дообучения по умолчанию можно очистить, берутся только 👍", async () => {
    const llm: LlmProvider = { chat: async () => ({ content: "Ваш ключ sk-abcdef1234567890XYZ сохранён", toolCalls: [] }) };
    const a = new Assistant({ llm, memory: new Memory(), log: quiet, prefs: () => ({ suggestions: "off", summaries: false }) });
    const r1 = await a.ask("мой email anna@example.com");
    const r2 = await a.ask("второй вопрос");
    await a.feedback(r1.turnId, 1);
    await a.feedback(r2.turnId, -1);
    const raw = await a.exportDataset();
    const clean = await a.exportDataset({ redact: true });
    expect(raw.split("\n")).toHaveLength(1);
    expect(raw).toContain("anna@example.com");
    expect(clean).not.toContain("anna@example.com");
    expect(clean).not.toContain("sk-abcdef1234567890XYZ");
    expect(a.turnsSnapshot()).toHaveLength(2);
  });
});

describe("режим проверки качества (ephemeral)", () => {
  it("не оставляет следов: ни записи хода, ни сессии, ни предложений в память", async () => {
    const memory = new Memory();
    const a = new Assistant({ llm: scripted("Хорошо").llm, memory, log: quiet });
    const r = await a.ask("Запомни: кофе без сахара", "eval", undefined, { history: [], ephemeral: true });
    expect(r).toMatchObject({ reply: "Хорошо", turnId: "" });
    expect(a.turnsSnapshot()).toEqual([]);
    expect(await memory.list()).toEqual([]);
    expect(await a.exportDataset()).toBe("");
  });
  it("не вызывает инструменты с последствиями, даже если ответ модели их просит и подтверждение есть", async () => {
    const run = vi.fn(() => "выполнено");
    const replies: LlmResponse[] = [{ content: null, toolCalls: [{ id: "c", name: "wipe", arguments: "{}" }] }, { content: "готово", toolCalls: [] }];
    const llm: LlmProvider = { chat: async () => replies.shift()! };
    const a = new Assistant({ llm, memory: new Memory(), log: quiet, approve: () => true });
    a.tools.register({ name: "wipe", description: "", risk: "write", parameters: { type: "object" }, run });
    const events: { status?: string }[] = [];
    await a.ask("x", "s", undefined, { ephemeral: true, onEvent: (e) => { if (e.type === "tool" && e.phase === "end") events.push(e); } });
    expect(run).not.toHaveBeenCalled();
    expect(events[0]!.status).toBe("denied");
  });
});

describe("инструкции владельца", () => {
  it("попадают в системное сообщение каждого запроса и меняются на лету", async () => {
    let system = "";
    const llm = { chat: async (m: { role: string; content: string | null }[]) => { system = String(m[0]!.content); return { content: "ок", toolCalls: [] }; } };
    let text = "Отвечай коротко.";
    const a = new Assistant({ llm: llm as never, memory: new Memory(), instructions: () => text });
    await a.ask("привет");
    expect(system).toContain("Отвечай коротко.");
    text = "";
    await a.ask("ещё");
    expect(system).not.toContain("Отвечай коротко.");
  });
});
