import { describe, expect, it } from "vitest";
import { Assistant } from "../src/assistant";
import { Memory } from "../src/memory";
import type { LlmProvider } from "../src/llm";

describe("automatic memory proposals", () => {
  it("proposes facts without making them active", async () => {
    let count = 0;
    const llm: LlmProvider = { chat: async () => (++count === 1 ?
      { content: "Хорошо", toolCalls: [] } :
      { content: JSON.stringify({ text: "Я предпочитаю тёмную тему", kind: "preference", revisesId: null }), toolCalls: [] }) };
    const memory = new Memory();
    const assistant = new Assistant({ llm, memory });
    expect((await assistant.ask("Я предпочитаю тёмную тему интерфейса")).reply).toBe("Хорошо");
    expect(await memory.search("тёмную тему")).toHaveLength(0);
    await assistant.idle();
    const proposed = await memory.list("pending");
    expect(proposed).toHaveLength(1);
    await memory.approve(proposed[0]!.id);
    expect(await memory.search("тёмную тему")).toHaveLength(1);
  });
  it("does not break chat when extraction fails", async () => {
    let n = 0;
    const llm: LlmProvider = { chat: async () => {
      if (++n === 1) return { content: "Готово", toolCalls: [] };
      throw new Error("network failure");
    } };
    const m = new Memory();
    const a = new Assistant({ llm, memory: m });
    expect((await a.ask("Я постоянно использую тёмную тему")).reply).toBe("Готово");
    await a.idle();
    expect(await m.list()).toEqual([]);
  });
  it("ignores questions and unrelated short commands", async () => {
    let count = 0;
    const llm: LlmProvider = { chat: async () => { count++; return { content: "Да", toolCalls: [] }; } };
    const assistant = new Assistant({ llm });
    await assistant.ask("Как дела?");
    await assistant.ask("Делай");
    expect(count).toBe(2);
  });
  it("uses the same model to propose a fact when explicit pattern matching misses it", async () => {
    let calls = 0;
    const llm: LlmProvider = { chat: async () => (++calls === 1
      ? { content: "Принято", toolCalls: [] }
      : { content: JSON.stringify({ text: "Мне требуется краткий ответ", kind: "preference" }), toolCalls: [] }) };
    const memory = new Memory();
    const assistant = new Assistant({ llm, memory });
    await assistant.ask("Мне требуется краткий ответ в каждом разговоре");
    await assistant.idle();
    expect(calls).toBe(2);
    expect((await memory.list("pending")).map(x => x.text)).toEqual(["Мне требуется краткий ответ"]);
    expect(await memory.search("ответ")).toEqual([]);
  });

});
