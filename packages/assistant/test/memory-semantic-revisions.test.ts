import { describe, it, expect } from "vitest";
import { Assistant } from "../src/assistant";
import { Memory } from "../src/memory";
import type { LlmProvider } from "../src/llm";

describe("semantic preference revisions", () => {
  it("links a contradictory preference as pending using the same chat model", async () => {
    const memory = new Memory();
    const old = await memory.add("preference", "короткие ответы", "active");
    let calls = 0;
    const llm: LlmProvider = { chat: async () => {
      calls++;
      return calls === 1 ? { content: "Хорошо", toolCalls: [] }
        : { content: JSON.stringify({ revisesId: old.id }), toolCalls: [] };
    } };
    await new Assistant({ llm, memory }).ask("Я предпочитаю подробные ответы");
    const pending = await memory.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ revisesId: old.id, status: "pending" });
    expect((await memory.list("active"))[0]?.id).toBe(old.id);
    await memory.approve(pending[0]!.id);
    expect((await memory.list()).find(e => e.id === old.id)?.supersededBy).toBe(pending[0]!.id);
    expect(calls).toBe(2);
  });
  it("rejects model guesses pointing at unrelated topics or invented IDs", async () => {
    const memory = new Memory();
    const old = await memory.add("preference", "тёмную тему", "active");
    const llm: LlmProvider = { chat: async (messages) =>
      ({ content: messages.length === 2 ? JSON.stringify({ revisesId: old.id }) : "Хорошо", toolCalls: [] }) };
    await new Assistant({ llm, memory }).ask("Я предпочитаю горячий чай");
    expect((await memory.list("pending"))[0]?.revisesId).toBeUndefined();
    expect((await memory.list("active"))[0]?.id).toBe(old.id);
  });
});
