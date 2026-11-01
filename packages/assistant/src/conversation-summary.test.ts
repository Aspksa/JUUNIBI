import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, Message } from "./llm";
import { ConversationSummaryService } from "./conversation-summary";
import { MemoryAdapter } from "./memory";

const older = Array.from({ length: 85 }, (_, index): Message => ({
  role: index % 2 ? "assistant" : "user", content: "Turn " + index,
}));

describe("conversation summary coverage", () => {
  it("summarizes every old turn in order without silently skipping a middle chunk", async () => {
    const seen: string[][] = [];
    const llm: LlmProvider = { chat: vi.fn(async messages => {
      const data = JSON.parse(messages[1]!.content ?? "{}") as { messages: Message[] };
      seen.push(data.messages.map(x => x.content ?? ""));
      return { content: "summary " + seen.length, toolCalls: [] };
    }) };
    const service = new ConversationSummaryService({ llm, store: new MemoryAdapter(), waitForChatIdle: async () => {} });
    service.queue("session", older);
    await service.idle();
    expect(seen[0]).toEqual(older.slice(0, 60).map(x => x.content));
    expect(await service.get("session", older)).toBe("summary 1");
    service.queue("session", older);
    await service.idle();
    expect(seen[1]).toEqual(older.slice(60).map(x => x.content));
    expect(await service.get("session", older)).toBe("summary 2");
  });

  it("does not reuse a summary after earlier conversation turns were edited", async () => {
    const store = new MemoryAdapter();
    const llm: LlmProvider = { chat: vi.fn(async () => ({ content: "original", toolCalls: [] })) };
    const service = new ConversationSummaryService({ llm, store, waitForChatIdle: async () => {} });
    service.queue("session", older.slice(0, 25));
    await service.idle();
    expect(await service.get("session", older)).toBe("original");
    const edited = older.map(x => ({ ...x }));
    edited[3]!.content = "Changed historic turn";
    expect(await service.get("session", edited)).toBeUndefined();
  });
});
