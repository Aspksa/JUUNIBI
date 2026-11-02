import { describe, expect, it } from "vitest";
import { MemoryAdapter } from "@juunibi/assistant";
import { RamoEvolution } from "./ramo-evolution";
import { conversationCue } from "./ramo-cognitive";

describe("RAMO Evolution 5 integration", () => {
  const chats = [{ id: "chat", messages: [
    { id: "1", role: "user", content: "Отвечай мне коротко и ясно" },
    { id: "2", role: "user", content: "Хочу сделать долговременную память" },
  ] }];
  it("recalls approved memories only and does not resurrect forgotten records", async () => {
    const store = new MemoryAdapter();
    const engine = new RamoEvolution(store, () => chats, () => 100_000);
    await engine.configure({ enabled: true, night: false });
    await engine.run(true);
    const state = await engine.snapshot();
    expect(state.schemaVersion).toBe(6);
    const item = state.cognitiveMemories.find(x => x.tier === "personal")!;
    expect(await engine.cognitiveRecall("отвечай коротко")).toEqual([]);
    await engine.reviewMemory(item.id, "approved");
    const retrieved = await engine.cognitiveRecall("отвечай коротко");
    expect(retrieved).toHaveLength(1);
    expect(conversationCue(retrieved)).toContain("ДАННЫЕ");
    await engine.forgetMemory(item.id);
    await engine.run(true);
    expect(await engine.cognitiveRecall("отвечай коротко")).toEqual([]);
    expect((await engine.snapshot()).cognitiveMemories.some(x => x.id === item.id)).toBe(false);
    const restarted = new RamoEvolution(store, () => chats, () => 200_000);
    expect((await restarted.snapshot()).forgottenIds).toContain(item.id);
    await restarted.run(true);
    expect((await restarted.snapshot()).cognitiveMemories.some(x => x.id === item.id)).toBe(false);
  });
  it("requires approved goals and never executes external actions", async () => {
    const engine = new RamoEvolution(new MemoryAdapter(), () => chats, () => 100_000);
    await engine.configure({ enabled: true, night: false });
    await engine.run(true);
    const goal = (await engine.snapshot()).goals[0]!;
    await expect(engine.queueReview(goal.id, "quality-review")).rejects.toThrow();
    await engine.setGoal(goal.id, "approved");
    await engine.queueReview(goal.id, "quality-review");
    await engine.run(true);
    const state = await engine.snapshot();
    expect(state.jobs[0]?.status).toBe("done");
    expect(state.audit.some(x => x.action === "job-done")).toBe(true);
  });
});
