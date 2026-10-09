import { describe, expect, it } from "vitest";
import { Memory } from "../src/memory";
import { Assistant } from "../src/assistant";
import type { LlmProvider } from "../src/llm";

describe("memory proposal guardrails", () => {
  it.each([
    ["Мне требуется краткий ответ, карта 1234", "Мне требуется краткий ответ карта 1234"],
    ["Мне требуется краткий ответ 123456789012", "Мне требуется краткий ответ 123456789012"],
  ])("rejects sensitive model proposals: %s", async (message, proposal) => {
    let calls = 0;
    const llm: LlmProvider = { chat: async () => ({ content: ++calls === 1 ? "Принято" : JSON.stringify({ text: proposal, kind: "preference" }), toolCalls: [] }) };
    const memory = new Memory();
    await new Assistant({ llm, memory }).ask(message);
    expect(await memory.list()).toEqual([]);
  });
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
    expect((await assistant.ask("Мой коллега обсуждал тёмный интерфейс во всех приложениях")).reply).toBe("Хорошо");
    expect(await memory.list("pending")).toEqual([]);
  });
  it("does not expose mutable relatedIds via list or search", async () => {
    const memory = new Memory();
    const a = await memory.add("fact", "лиса любит проекты", "active");
    const b = await memory.add("fact", "лиса работает в команде", "active");
    await memory.relate(a.id, b.id);
    const listed = await memory.list();
    listed[0]!.relatedIds!.push("forged-id");
    const searched = await memory.search("лиса");
    searched[0]!.relatedIds!.push("another-forged-id");
    const fresh = (await memory.list()).find(x => x.id === a.id)!;
    expect(fresh.relatedIds).toEqual([b.id]);
  });

});
