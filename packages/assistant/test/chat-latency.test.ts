import { describe, it, expect, vi } from "vitest";
import { Assistant } from "../src/assistant";
import { CloudRuProvider, LlmError, type ChatOptions, type LlmProvider, type Message } from "../src/llm";
import { Memory, MemoryAdapter } from "../src/memory";

const quiet = { debug() {}, info() {}, warn() {}, error() {} } as never;

describe("chat latency during Cloud.ru outages", () => {
  it("a waiting reply uses a short timeout and a single retry, then says Cloud.ru is unavailable", async () => {
    const f = vi.fn(async () => new Response("", { status: 503 }));
    const p = new CloudRuProvider({ apiKey: "SECRET", model: "m", fetch: f as never });
    const e = await p.chat([], { retries: 1, timeoutMs: 1000 }).catch((x) => x);
    expect(f).toHaveBeenCalledTimes(2);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.status).toBe(503);
    expect(e.message).toContain("Cloud.ru временно недоступен");
  });

  it("a hung request is cut by the per-call timeout", async () => {
    const f = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) =>
      init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const p = new CloudRuProvider({ apiKey: "k", model: "m", fetch: f as never });
    const t0 = Date.now();
    const e = await p.chat([], { retries: 0, timeoutMs: 50 }).catch((x) => x);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(e.message).toContain("тайм-аут");
  });

  it("the assistant asks for the short chat timeout; the summary waits until the reply is done", async () => {
    const calls: { kind: string; opts: ChatOptions | undefined }[] = [];
    let replying = false;
    const llm: LlmProvider = { chat: async (m: Message[], opts?: ChatOptions) => {
      const summary = String(m[0]?.content).startsWith("Ты ведёшь");
      calls.push({ kind: summary ? "summary" : "chat", opts });
      if (summary) { expect(replying).toBe(false); return { content: "сводка", toolCalls: [] }; }
      replying = true; await new Promise((r) => setTimeout(r, 20)); replying = false;
      return { content: "ответ", toolCalls: [] };
    } };
    const a = new Assistant({ llm, memory: new Memory(), log: quiet, prefs: () => ({ suggestions: "off", summaries: true }) });
    const history = Array.from({ length: 25 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "assistant" | "user", content: "Сообщение " + i }));
    expect((await a.ask("привет", "s", undefined, { history })).reply).toBe("ответ");
    await a.idle();
    expect(calls.map((c) => c.kind)).toEqual(["chat", "summary"]);
    expect(calls[0]!.opts).toMatchObject({ timeoutMs: 20_000, retries: 1 });
    expect(a.isAnswering()).toBe(false);
  });
});

describe("semantic memory on the chat path", () => {
  it("never delays a reply beyond the budget when embeddings hang", async () => {
    const m = new Memory();
    await m.add("fact", "лиса любит лес", "active");
    let slow = true;
    m.setEmbeddingProvider({ embed: async () => { if (slow) await new Promise((r) => setTimeout(r, Memory.CHAT_EMBED_BUDGET_MS + 2000)); return [1, 0]; } });
    const t0 = Date.now();
    expect(await m.searchHybrid("лиса", 3)).toHaveLength(1);
    const took = Date.now() - t0;
    expect(took).toBeLessThan(Memory.CHAT_EMBED_BUDGET_MS + 1000);
    expect(m.embeddingDiagnostics().failures).toBe(1);
    slow = false;
  }, 10_000);

  it("saves vectors to disk and reuses them after a restart for the same model only", async () => {
    const store = new MemoryAdapter();
    const entries = new MemoryAdapter();
    const first = new Memory(entries);
    await first.add("fact", "лиса любит лес", "active");
    await first.setVectorStore(store);
    const embed = vi.fn(async () => [1, 0]);
    first.setEmbeddingProvider({ id: "model-a", embed });
    await first.searchHybrid("лиса", 3);
    expect(embed).toHaveBeenCalledTimes(2); // the query and the entry
    await new Promise((r) => setTimeout(r, 2200));
    expect(JSON.parse((await store.load())!).provider).toBe("model-a");

    const second = new Memory(entries);
    await second.setVectorStore(store);
    const again = vi.fn(async () => [1, 0]);
    second.setEmbeddingProvider({ id: "model-a", embed: again });
    await second.searchHybrid("лиса", 3);
    expect(again).toHaveBeenCalledTimes(1); // only the query: the entry vector came from disk

    const other = vi.fn(async () => [1, 0]);
    second.setEmbeddingProvider({ id: "model-b", embed: other });
    await second.searchHybrid("лиса", 3);
    expect(other).toHaveBeenCalledTimes(2);
  }, 10_000);
});
