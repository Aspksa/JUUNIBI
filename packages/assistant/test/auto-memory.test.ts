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
});
