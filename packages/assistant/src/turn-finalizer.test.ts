import { describe, expect, it, vi } from "vitest";
import type { MemoryEntry } from "./memory";
import { TurnFinalizer } from "./turn-finalizer";

const memory = (id = "m1", text = "remembered"): MemoryEntry => ({
  id,
  kind: "fact",
  text,
  status: "active",
  score: 0,
  createdAt: 1,
});

function make() {
  const appendTurn = vi.fn();
  const record = vi.fn(async (input) => ({ ...input, id: "t1", at: 1 }));
  const summaryQueue = vi.fn();
  const memoryQueue = vi.fn();
  return {
    appendTurn,
    record,
    summaryQueue,
    memoryQueue,
    finalizer: new TurnFinalizer({
      sessions: { appendTurn },
      journal: { record },
      summaries: { queue: summaryQueue },
      memoryLearning: { queue: memoryQueue },
    }),
  };
}

describe("TurnFinalizer", () => {
  it("persists a normal turn and schedules background summary/memory work", async () => {
    const x = make();
    const result = await x.finalizer.finalize({
      session: "s",
      user: "u",
      reply: "r",
      tools: ["tool"],
      memories: [memory()],
      prefs: { suggestions: "smart", summaries: true },
      olderHistory: [{ role: "user", content: "old" }],
      usesClientHistory: false,
      ephemeral: false,
      background: "full",
    });

    expect(result).toEqual({ turnId: "t1", reply: "r", tools: ["tool"], memory: ["remembered"] });
    expect(x.appendTurn).toHaveBeenCalledWith("s", "u", "r");
    expect(x.record).toHaveBeenCalledWith({
      session: "s",
      user: "u",
      reply: "r",
      tools: ["tool"],
      memoryIds: ["m1"],
    });
    expect(x.summaryQueue).toHaveBeenCalledWith("s", [{ role: "user", content: "old" }]);
    expect(x.memoryQueue).toHaveBeenCalledWith("u", "smart");
  });

  it("keeps ephemeral replies trace-free", async () => {
    const x = make();
    const result = await x.finalizer.finalize({
      session: "s",
      user: "u",
      reply: "r",
      tools: [],
      memories: [memory()],
      prefs: { suggestions: "smart", summaries: true },
      olderHistory: [{ role: "user", content: "old" }],
      usesClientHistory: false,
      ephemeral: true,
      background: "full",
    });

    expect(result.turnId).toBe("");
    expect(x.appendTurn).not.toHaveBeenCalled();
    expect(x.record).not.toHaveBeenCalled();
    expect(x.summaryQueue).not.toHaveBeenCalled();
    expect(x.memoryQueue).not.toHaveBeenCalled();
  });

  it("does not mutate server fallback history when client history is authoritative", async () => {
    const x = make();
    await x.finalizer.finalize({
      session: "s",
      user: "u",
      reply: "r",
      tools: [],
      memories: [],
      prefs: { suggestions: "off", summaries: false },
      olderHistory: [],
      usesClientHistory: true,
      ephemeral: false,
      background: "full",
    });

    expect(x.appendTurn).not.toHaveBeenCalled();
    expect(x.record).toHaveBeenCalledTimes(1);
  });

  it("preserves functional-diagnostic behavior without background learning", async () => {
    const x = make();
    await x.finalizer.finalize({
      session: "s",
      user: "check",
      reply: "report",
      tools: ["functional_health_check"],
      memories: [memory()],
      prefs: { suggestions: "smart", summaries: true },
      olderHistory: [{ role: "user", content: "old" }],
      usesClientHistory: false,
      ephemeral: false,
      background: "none",
    });

    expect(x.appendTurn).toHaveBeenCalled();
    expect(x.record).toHaveBeenCalled();
    expect(x.summaryQueue).not.toHaveBeenCalled();
    expect(x.memoryQueue).not.toHaveBeenCalled();
  });
});
