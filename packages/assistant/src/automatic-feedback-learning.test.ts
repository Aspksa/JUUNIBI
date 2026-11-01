import { describe, expect, it, vi } from "vitest";
import { Assistant } from "./assistant";
import { Memory } from "./memory";
import type { LlmProvider } from "./llm";

describe("automatic owner-feedback learning", () => {
  it("proposes a pending lesson after negative feedback without activating it", async () => {
    const memory = new Memory();
    const chat = vi.fn(async () => ({ content: '["Перед ответом проверяй факты"]', toolCalls: [] }));
    const assistant = new Assistant({ llm: { chat } as LlmProvider, memory,
      prefs: () => ({ suggestions: "smart", summaries: false }) });
    const turn = await assistant.ask("Проверь факты", "feedback-session");
    expect(await assistant.feedback(turn.turnId, -1)).toBe(true);
    await assistant.idle();
    expect((await memory.list("pending")).map(entry => entry.text)).toContain("Перед ответом проверяй факты");
    expect(await memory.list("active")).toEqual([]);
    expect(await assistant.feedback(turn.turnId, -1)).toBe(true);
    await assistant.idle();
    expect(await memory.list("pending")).toHaveLength(1);
  });

  it("does not reflect in disabled learning mode or on positive feedback", async () => {
    const memory = new Memory();
    const chat = vi.fn(async () => ({ content: "ok", toolCalls: [] }));
    const assistant = new Assistant({ llm: { chat } as LlmProvider, memory,
      prefs: () => ({ suggestions: "off", summaries: false }) });
    const turn = await assistant.ask("Сделай отчёт", "feedback-session");
    expect(await assistant.feedback(turn.turnId, -1)).toBe(true);
    await assistant.idle();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(await memory.list("pending")).toEqual([]);
  });
});
