import { describe, expect, it, vi } from "vitest";
import { MemoryLearningService } from "./memory-learning";
import { Memory } from "./memory";
import type { LlmProvider } from "./llm";

describe("chat correction learning", () => {
  it("proposes an explicit correction as a pending lesson, never auto-approves", async () => {
    const memory = new Memory();
    const llm: LlmProvider = { chat: vi.fn(async () => ({
      content: JSON.stringify({ text: "Для планирования проекта сначала проверяй зависимости", kind: "lesson" }),
      toolCalls: [],
    })) };
    const service = new MemoryLearningService({ llm, memory, waitForChatIdle: async () => {} });
    service.queue("Нет, для планирования проекта сначала проверяй зависимости.", "smart");
    await service.idle();
    expect((await memory.list("pending")).map(x => x.kind)).toContain("lesson");
    expect(await memory.list("active")).toEqual([]);
  });

  it("never makes a model-generated lesson from uncorrected chat or off mode", async () => {
    const memory = new Memory();
    const llm: LlmProvider = { chat: vi.fn(async () => ({
      content: JSON.stringify({ text: "Я предпочитаю писать аккуратно", kind: "lesson" }), toolCalls: [],
    })) };
    const service = new MemoryLearningService({ llm, memory, waitForChatIdle: async () => {} });
    service.queue("Я предпочитаю писать аккуратно", "smart");
    service.queue("Нет, я предпочитаю писать аккуратно", "off");
    await service.idle();
    expect(await memory.list("pending")).toEqual([]);
  });
});
