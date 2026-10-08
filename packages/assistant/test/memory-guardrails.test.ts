import { describe, expect, it } from "vitest";
import { Memory } from "../src/memory";
import { Assistant } from "../src/assistant";
import type { LlmProvider } from "../src/llm";

describe("memory proposal guardrails", () => {
  it("does not propose secrets or multiline quotes", async () => {
    const memory = new Memory();
    expect(await memory.suggestFromUserText("запомни пароль secret 123456")).toEqual([]);
    expect(await memory.suggestFromUserText("я предпочитаю строку\nиз другого источника")).toEqual([]);
    expect(await memory.list("pending")).toEqual([]);
  });
  it("rejects unsupported model facts but keeps the chat answer", async () => {
    let calls = 0;
    const llm: LlmProvider = { chat: async () => (++calls === 1
      ? { content: "Хорошо", toolCalls: [] }
      : { content: JSON.stringify({ text: "Я живу на Марсе", kind: "fact" }), toolCalls: [] }) };
    const memory = new Memory();
    const assistant = new Assistant({ llm, memory });
    expect((await assistant.ask("Мне нравится тёмный интерфейс во всех приложениях")).reply).toBe("Хорошо");
    expect(await memory.list("pending")).toEqual([]);
  });
});
