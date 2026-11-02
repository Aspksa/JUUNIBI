import { describe, expect, it } from "vitest";
import { MemoryAdapter } from "@juunibi/assistant";
import { RamoEvolution } from "./ramo-evolution";

describe("RamoEvolution", () => {
  it("stays disabled by default and never approves suggestions automatically", async () => {
    const store = new MemoryAdapter();
    const chats = [{ id: "chat-1", messages: [{ id: "m1", role: "user", content: "Отвечай мне кратко и без повторов" }] }];
    const engine = new RamoEvolution(store, () => chats, () => 100000);
    await engine.run(true);
    expect((await engine.snapshot()).queue).toEqual([]);
    await engine.configure({ enabled: true, intervalMinutes: 15, night: false });
    await engine.run(true);
    const state = await engine.snapshot();
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]!.status).toBe("pending");
    expect(state.analyzedMessages).toBe(1);
    expect(state.memoryDigest).toHaveLength(1);
    expect(state.qualitySignals).toBe(0);
    await engine.run(true);
    expect((await engine.snapshot()).queue).toHaveLength(1);
    const restored = new RamoEvolution(store, () => chats, () => 200000);
    expect((await restored.snapshot()).queue).toHaveLength(1);
    expect((await restored.snapshot()).analyzedMessages).toBe(1);
    await restored.decide(state.queue[0]!.id, "rejected");
    expect((await restored.snapshot()).queue[0]!.status).toBe("rejected");
  });

  it("validates configuration and rejects unknown decisions", async () => {
    const engine = new RamoEvolution(new MemoryAdapter(), () => []);
    await expect(engine.configure({ intervalMinutes: 17 as 15 })).rejects.toThrow();
    await expect(engine.decide("missing", "accepted")).rejects.toThrow();
  });
  it("removes stale graph edges and conflicts after nightly memory expiry", async () => {
    const store = new MemoryAdapter();
    const seed = new RamoEvolution(store, () => [], () => 100_000);
    const state = await seed.snapshot();
    state.config = { ...state.config, enabled: true, night: true };
    state.cognitiveMemories = [
      { id: "old", tier: "personal", content: "always prefer short answers", source: "chat", confidence: 1, observedAt: 1, expiresAt: 10, status: "approved" },
      { id: "live", tier: "personal", content: "always prefer short answers", source: "chat", confidence: 1, observedAt: 1, status: "approved" },
    ];
    state.graphEdges = [{ from: "old", to: "live", strength: 1 }];
    state.memoryConflicts = [{ first: "old", second: "live" }];
    await store.save(JSON.stringify(state));
    const engine = new RamoEvolution(store, () => [], () => 100_000);
    await engine.run(true);
    const after = await engine.snapshot();
    expect(after.cognitiveMemories.map(x => x.id)).toEqual(["live"]);
    expect(after.graphEdges).toEqual([]);
    expect(after.memoryConflicts).toEqual([]);
  });

});
