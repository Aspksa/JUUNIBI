import { describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "./llm";
import { Memory, MemoryAdapter } from "./memory";
import { TurnJournal } from "./turn-journal";

describe("TurnJournal", () => {
  it("persists turns and returns defensive snapshots", async () => {
    const store = new MemoryAdapter();
    const memory = new Memory();
    const llm: LlmProvider = { chat: async () => ({ content: "[]", toolCalls: [] }) };
    const journal = new TurnJournal({ llm, memory, store });
    const turn = await journal.record({ session: "s", user: "u", reply: "r", tools: ["t"], memoryIds: [] });

    const snapshot = journal.snapshot();
    snapshot[0]!.tools.push("mutated");
    expect(journal.snapshot()[0]!.tools).toEqual(["t"]);

    const reloaded = new TurnJournal({ llm, memory, store });
    expect(reloaded.snapshot()).toEqual([]);
    await reloaded.feedback(turn.id, 1);
    expect(reloaded.snapshot()[0]).toMatchObject({ id: turn.id, rating: 1 });
  });

  it("applies feedback to memories and exports only thumbs-up turns", async () => {
    const memory = new Memory();
    const entry = await memory.add("fact", "кофе без сахара", "active");
    const journal = new TurnJournal({
      llm: { chat: async () => ({ content: "[]", toolCalls: [] }) },
      memory,
    });
    const liked = await journal.record({ session: "s", user: "email a@example.com", reply: "ok", tools: [], memoryIds: [entry.id] });
    const disliked = await journal.record({ session: "s", user: "x", reply: "y", tools: [], memoryIds: [] });

    await journal.feedback(liked.id, 1);
    await journal.feedback(disliked.id, -1);
    expect((await memory.list()).find((item) => item.id === entry.id)?.score).toBe(1);
    expect((await journal.exportDataset()).split("\n")).toHaveLength(1);
    expect(await journal.exportDataset({ redact: true })).not.toContain("a@example.com");
  });

  it("reflection proposes pending lessons and retries after provider failure", async () => {
    const memory = new Memory();
    const chat = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ content: '["Пользователь любит краткие ответы"]', toolCalls: [] });
    const journal = new TurnJournal({ llm: { chat } as LlmProvider, memory });
    const turn = await journal.record({ session: "s", user: "коротко", reply: "ок", tools: [], memoryIds: [] });

    await expect(journal.reflect(turn.id)).rejects.toThrow("offline");
    const lessons = await journal.reflect(turn.id);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ kind: "lesson", status: "pending" });
    expect(await journal.reflect(turn.id)).toEqual([]);
  });
});
