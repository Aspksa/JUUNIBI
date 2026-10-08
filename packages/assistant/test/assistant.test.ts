import { describe, expect, it, vi } from "vitest";
import { Kernel, Logger } from "@juunibi/core";
import { Assistant, CloudRuProvider, LlmError, readStream, Memory, ToolRegistry, assistantPlugin, type LlmProvider, type LlmResponse, type Message } from "../src";

const quiet = new Logger("t", "silent");
function scripted(...rs: LlmResponse[]): LlmProvider & { seen: Message[][] } {
  const seen: Message[][] = [];
  return { seen, chat: async (m) => { seen.push(structuredClone(m)); return rs.shift() ?? { content: "конец", toolCalls: [] }; } };
}
const say = (content: string): LlmResponse => ({ content, toolCalls: [] });
const call = (name: string, args: object = {}): LlmResponse => ({ content: null, toolCalls: [{ id: "c1", name, arguments: JSON.stringify(args) }] });

describe("Assistant", () => {
  it("runs a tool loop and answers", async () => {
    const llm = scripted(call("list_modules"), say("Модулей: 1"));
    const a = new Assistant({ llm, log: quiet, describeModules: () => [{ name: "x" }] });
    const r = await a.ask("что в проекте?");
    expect(r.reply).toBe("Модулей: 1");
    expect(r.tools).toEqual(["list_modules"]);
    expect(llm.seen[1]!.at(-1)!.content).toContain('"x"');
  });

  it("denies write tools without a supervisor, allows with one", async () => {
    const run = vi.fn(() => "done");
    const mk = (approve?: () => boolean) => {
      const a = new Assistant({ llm: scripted(call("wipe"), say("ok")), log: quiet, ...(approve ? { approve } : {}) });
      a.tools.register({ name: "wipe", description: "", risk: "danger", parameters: { type: "object" }, run });
      return a;
    };
    await mk().ask("x");
    expect(run).not.toHaveBeenCalled();
    await mk(() => true).ask("x");
    expect(run).toHaveBeenCalledOnce();
  });

  it("survives bad tool calls and tool errors", async () => {
    const llm = scripted(
      { content: null, toolCalls: [
        { id: "1", name: "nope", arguments: "{}" },
        { id: "2", name: "search_memory", arguments: "not json" },
        { id: "3", name: "search_memory", arguments: "{}" },
        { id: "4", name: "boom", arguments: "{}" },
      ] },
      say("ок"),
    );
    const a = new Assistant({ llm, log: quiet });
    a.tools.register({ name: "boom", description: "", risk: "read", parameters: { type: "object" }, run: () => { throw new Error("bang"); } });
    expect((await a.ask("x")).reply).toBe("ок");
    const results = llm.seen[1]!.filter((m) => m.role === "tool").map((m) => m.content);
    expect(results[0]).toMatch(/нет/);
    expect(results[1]).toMatch(/JSON/);
    expect(results[2]).toMatch(/не хватает/);
    expect(results[3]).toMatch(/bang/);
  });

  it("stops after maxSteps", async () => {
    const llm = scripted(call("list_modules"), call("list_modules"), call("list_modules"));
    const r = await new Assistant({ llm, log: quiet, maxSteps: 2 }).ask("x");
    expect(r.reply).toMatch(/шагов/);
  });

  it("learns only with approval: remember -> pending -> approve -> recalled", async () => {
    const memory = new Memory();
    const a = new Assistant({ llm: scripted(call("remember", { text: "Люблю тёмную тему", kind: "preference" }), say("запомнил")), memory, log: quiet });
    await a.ask("запомни");
    expect(await memory.search("тёмную тему")).toHaveLength(0);
    const [p] = await memory.list("pending");
    await memory.approve(p!.id);
    const llm = scripted(say("ок"));
    await new Assistant({ llm, memory, log: quiet }).ask("какую тему я люблю");
    expect(llm.seen[0]![0]!.content).toContain("Люблю тёмную тему");
  });

  it("feedback adjusts memory score; reflect proposes pending lessons; dataset keeps thumbs-up only", async () => {
    const memory = new Memory();
    const m = await memory.add("fact", "кофе без сахара", "active");
    const a = new Assistant({ llm: scripted(say("Без сахара."), say('["Пользователь пьёт кофе без сахара"]')), memory, log: quiet });
    const r = await a.ask("какой кофе");
    await a.feedback(r.turnId, 1);
    expect((await memory.list()).find((e) => e.id === m.id)!.score).toBe(1);
    await a.feedback(r.turnId, -1);
    expect((await memory.list()).find((e) => e.id === m.id)!.score).toBe(-1);
    expect(await a.exportDataset()).toBe("");
    await a.feedback(r.turnId, 1);
    const lessons = await a.reflect(r.turnId);
    expect(lessons[0]!.status).toBe("pending");
    expect(JSON.parse((await a.exportDataset()).split("\n")[0]!).messages[1].content).toBe("Без сахара.");
  });

  it("memory ignores corrupt storage and dedupes", async () => {
    const mem = new Memory({ load: async () => "{broken", save: async () => {} });
    await mem.add("fact", "a b", "active");
    await mem.add("fact", "A B", "active");
    expect(await mem.list()).toHaveLength(1);
  });

  it("works as a kernel plugin that other modules extend with tools", async () => {
    const k = new Kernel(quiet);
    let asst: Assistant | undefined;
    k.register(assistantPlugin({ llm: scripted(call("ping"), say("pong!")) }, () => k.describe(), (a) => (asst = a)));
    k.register({ name: "pinger", deps: ["assistant"], start: (c) => void c.service<ToolRegistry>("assistant:tools").register({ name: "ping", description: "", risk: "read", parameters: { type: "object" }, run: () => "pong" }) });
    await k.start();
    expect((await asst!.ask("ping")).tools).toEqual(["ping"]);
  });
});

describe("CloudRuProvider", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const cfg = { apiKey: "SECRET", model: "m", retries: 2 };

  it("serializes tool-call history for the Cloud.ru function protocol", async () => {
    const f = vi.fn(async () => ok({ choices: [{ message: { content: "Готово" } }] }));
    const p = new CloudRuProvider({ ...cfg, fetch: f as never });
    const history: Message[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "c1", name: "list_modules", arguments: "{}" }] },
      { role: "tool", tool_call_id: "c1", content: "[]" },
    ];
    await p.chat(history);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_modules", arguments: "{}" } }] },
      history[1],
    ]);
    expect(history[0]!.tool_calls![0]).toEqual({ id: "c1", name: "list_modules", arguments: "{}" });
  });

  it("redacts credentials echoed by HTTP, network and stream errors", async () => {
    const failures = [
      async () => new Response("invalid Bearer SECRET", { status: 401 }),
      async () => { throw new Error("request with SECRET failed"); },
      async () => new Response('data: {"error":{"message":"invalid SECRET"}}\n\n', { headers: { "content-type": "text/event-stream" } }),
    ];
    for (const fetcher of failures) {
      const p = new CloudRuProvider({ ...cfg, retries: 0, fetch: fetcher as typeof fetch });
      const error = await p.chat([], { onText: () => {} }).catch(e => e);
      expect(error).toBeInstanceOf(LlmError);
      expect(error.message).not.toContain(cfg.apiKey);
    }
  });

  it("sends OpenAI-style request with bearer key and parses tool calls", async () => {
    const f = vi.fn(async () => ok({ choices: [{ message: { content: null, tool_calls: [{ id: "a", function: { name: "t", arguments: "{}" } }] } }] }));
    const p = new CloudRuProvider({ ...cfg, fetch: f as never });
    const r = await p.chat([{ role: "user", content: "hi" }], { tools: [{ name: "t", description: "", parameters: {} }] });
    expect(r.toolCalls[0]!.name).toBe("t");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://foundation-models.api.cloud.ru/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SECRET");
  });

  it("retries 5xx but not 4xx, and never leaks the key", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(ok({ choices: [{ message: { content: "ok" } }] }));
    const p = new CloudRuProvider({ ...cfg, fetch: f as never });
    expect((await p.chat([])).content).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
    const bad = new CloudRuProvider({ ...cfg, fetch: (async () => new Response("unauthorized", { status: 401 })) as never });
    const e = await bad.chat([]).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.message).not.toContain("SECRET");
  });

  it("rejects missing key/model", () => {
    expect(() => new CloudRuProvider({ apiKey: "", model: "m" })).toThrow();
    expect(() => new CloudRuProvider({ apiKey: "k", model: "" })).toThrow();
  });
});

describe("streaming", () => {
  const sse = (...chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const d = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

  it("readStream assembles text and tool-call fragments split across chunks", async () => {
    const texts: string[] = [];
    const body = sse(
      d({ choices: [{ delta: { content: "При" } }] }),
      'data: {"choices":[{"delta":{"content":"вет"}}]}\n',
      '\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"list_","arguments":"{\\"a\\":"}}]}}]}\n\n',
      d({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "modules", arguments: "1}" } }] } }] }),
      "data: [DONE]\n\n",
    ).body!;
    const r = await readStream(body, (t) => texts.push(t));
    expect(texts.join("")).toBe("Привет");
    expect(r.content).toBe("Привет");
    expect(r.toolCalls).toEqual([{ id: "c1", name: "list_modules", arguments: '{"a":1}' }]);
  });

  it("CloudRuProvider streams when onText is given, and sends stream:true", async () => {
    const f = vi.fn(async () => sse(d({ choices: [{ delta: { content: "a" } }] }), d({ choices: [{ delta: { content: "b" } }] }), "data: [DONE]\n\n"));
    const got: string[] = [];
    const r = await new CloudRuProvider({ apiKey: "k-12345678", model: "m", fetch: f as never }).chat([], { onText: (t) => got.push(t) });
    expect(got).toEqual(["a", "b"]);
    expect(r.content).toBe("ab");
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).stream).toBe(true);
  });

  it("falls back to a whole-text delta when the server ignores stream", async () => {
    const f = async () => new Response(JSON.stringify({ choices: [{ message: { content: "целиком" } }] }), { status: 200 });
    const got: string[] = [];
    await new CloudRuProvider({ apiKey: "k-12345678", model: "m", fetch: f as never }).chat([], { onText: (t) => got.push(t) });
    expect(got).toEqual(["целиком"]);
  });

  it("surfaces an error event from the stream", async () => {
    const body = sse(d({ error: { message: "quota" } })).body!;
    await expect(readStream(body, () => {})).rejects.toThrow(/quota/);
  });

  it("Assistant.ask emits delta/tool events and uses client history instead of server sessions", async () => {
    const seen: Message[][] = [];
    const llm: LlmProvider = {
      chat: async (m, o) => {
        seen.push(structuredClone(m));
        if (seen.length === 1) { o?.onText?.("Смотрю… "); return { content: "Смотрю… ", toolCalls: [{ id: "1", name: "list_modules", arguments: "{}" }] }; }
        o?.onText?.("Готово"); return { content: "Готово", toolCalls: [] };
      },
    };
    const a = new Assistant({ llm, log: quiet });
    const events: unknown[] = [];
    const r = await a.ask("что нового?", "s1", undefined, { history: [{ role: "user", content: "привет" }, { role: "assistant", content: "здравствуйте" }], onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: "delta", text: "Смотрю… " },
      { type: "tool", phase: "start", id: "1", name: "list_modules", args: "{}" },
      { type: "tool", phase: "end", id: "1", name: "list_modules", status: "ok", ms: expect.any(Number) },
      { type: "delta", text: "Готово" },
    ]);
    expect(r.reply).toBe("Готово");
    expect(seen[0]!.map((m) => m.content).slice(1)).toEqual(["привет", "здравствуйте", "что нового?"]);
    // server-side session memory was NOT touched: a later call without history starts clean
    seen.length = 0;
    await a.ask("второй", "s1");
    expect(seen[0]!.filter((m) => m.role !== "system")).toHaveLength(1);
  });
});

describe("tool events and history limits", () => {
  it("reports error and denied statuses", async () => {
    const llm: LlmProvider = { chat: async (m) => (m.some((x) => x.role === "tool") ? say("ок") : { content: null, toolCalls: [
      { id: "a", name: "nope", arguments: "{}" }, { id: "b", name: "wipe", arguments: "{}" }] }) };
    const a = new Assistant({ llm, log: quiet });
    a.tools.register({ name: "wipe", description: "", risk: "danger", parameters: { type: "object" }, run: () => "x" });
    const ends: string[] = [];
    await a.ask("x", "s", undefined, { onEvent: (e) => { if (e.type === "tool" && e.phase === "end") ends.push(e.name + ":" + e.status); } });
    expect(ends).toEqual(["nope:error", "wipe:denied"]);
  });
  it("keeps long client history (file attachments) but caps the total", async () => {
    const seen: Message[][] = [];
    const llm: LlmProvider = { chat: async (m) => { seen.push(m); return say("ok"); } };
    const big = "я".repeat(100_000);
    await new Assistant({ llm, log: quiet }).ask("q", "s", undefined, { history: [
      { role: "user", content: big }, { role: "assistant", content: "a" }, { role: "user", content: big }, { role: "assistant", content: "b" }, { role: "user", content: big }, { role: "assistant", content: "c" }] });
    const total = seen[0]!.filter((m) => m.role !== "system").reduce((n, m) => n + (m.content?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(300_000 + 1);
    expect(seen[0]!.at(-2)!.content).toBe("c"); // newest history survives
  });
});
