import { describe, expect, it } from "vitest";
import { TurnJournal } from "./turn-journal";
import { Memory, MemoryAdapter } from "./memory";
import type { LlmProvider } from "./llm";

const llm: LlmProvider = { chat: async () => ({ content: "", toolCalls: [] }) };
describe("session-scoped history retrieval", () => {
  it("finds older turns without exposing a different conversation", async () => {
    const journal = new TurnJournal({ llm, memory: new Memory(), store: new MemoryAdapter() });
    await journal.record({ session: "one", user: "Обсуждали архитектуру проекта", reply: "Используем единый реестр", tools: [], memoryIds: [] });
    await journal.record({ session: "two", user: "Обсуждали секретный проект", reply: "Другой пользователь", tools: [], memoryIds: [] });
    const result = await journal.search("one", "архитектуру", 5);
    expect(result).toHaveLength(1);
    expect(result[0]?.user).toContain("архитектуру");
    expect(result.some(turn => turn.session === "two")).toBe(false);
  });
  it("matches related Russian word forms and ignores conversational filler", async () => {
    const journal = new TurnJournal({ llm, memory: new Memory(), store: new MemoryAdapter() });
    await journal.record({ session: "one", user: "Обсудили архитектуру базы данных", reply: "Выбрали безопасный вариант", tools: [], memoryIds: [] });
    await journal.record({ session: "one", user: "Когда будет погода", reply: "Завтра", tools: [], memoryIds: [] });
    expect((await journal.search("one", "Что мы раньше обсуждали об архитектуре?")).map(x => x.user))
      .toEqual(["Обсудили архитектуру базы данных"]);
    expect(await journal.search("one", "Что мы раньше обсуждали?")).toEqual([]);
  });
  it("rejects empty and overlong queries", async () => {
    const journal = new TurnJournal({ llm, memory: new Memory(), store: new MemoryAdapter() });
    expect(await journal.search("one", "")).toEqual([]);
    expect(await journal.search("one", "x".repeat(301))).toEqual([]);
  });
});
