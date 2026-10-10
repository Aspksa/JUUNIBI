import { describe, expect, it } from "vitest";
import { Assistant } from "../src/assistant";
import type { LlmProvider, Message } from "../src/llm";

describe("background memory analysis", () => {
  it("waits for other in-flight replies before calling the model", async () => {
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const secondStarted = new Promise<void>((resolve) => { entered = resolve; });
    const llm: LlmProvider = { chat: async (messages: Message[]) => {
      const user = messages.at(-1)?.content ?? "";
      if (user === "Второй вопрос") { order.push("reply2:start"); entered(); await blocked; order.push("reply2:end"); return { content: "Второй ответ", toolCalls: [] }; }
      if (user === "Я постоянно использую тёмную тему") { order.push("reply1"); return { content: "Первый ответ", toolCalls: [] }; }
      order.push("memory");
      return { content: "{}", toolCalls: [] };
    } };
    const assistant = new Assistant({ llm });
    const second = assistant.ask("Второй вопрос");
    await secondStarted;
    await assistant.ask("Я постоянно использую тёмную тему");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["reply2:start", "reply1"]);
    release();
    await second;
    await assistant.idle();
    expect(order).toEqual(["reply2:start", "reply1", "reply2:end", "memory"]);
  });
});
