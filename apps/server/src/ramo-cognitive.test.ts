import { describe, expect, it } from "vitest";
import { MemoryAdapter } from "@juunibi/assistant";
import { classifyExperience, retrieveMemories, evaluateDialogue } from "./ramo-cognitive";
import { RamoEvolution } from "./ramo-evolution";

describe("RAMO Cognitive v4", () => {
  it("never retrieves unapproved or expired memories", () => {
    const item = classifyExperience({ id: "1", kind: "preference", text: "Отвечай кратко на вопросы",
      source: "chat", confidence: 0.9, createdAt: 100 });
    expect(item.tier).toBe("personal");
    expect(retrieveMemories([item], "отвечай кратко", 200)).toEqual([]);
    item.status = "approved";
    expect(retrieveMemories([item], "отвечай кратко", 200)).toHaveLength(1);
    item.expiresAt = 150;
    expect(retrieveMemories([item], "отвечай кратко", 200)).toEqual([]);
  });
  it("detects duplicate adjacent replies", () => {
    const result = evaluateDialogue([{ role: "assistant", content: "Привет" }, { role: "assistant", content: "Привет" }]);
    expect(result.failures.some(x => x.name === "repetition")).toBe(true);
  });
  it("persists approval and emergency pause across restart", async () => {
    const store = new MemoryAdapter();
    const chats = [{ id: "c", messages: [{ id: "m", role: "user", content: "Отвечай коротко и ясно" }] }];
    const engine = new RamoEvolution(store, () => chats, () => 100000);
    await engine.configure({ enabled: true, night: false });
    await engine.run(true);
    const item = (await engine.snapshot()).cognitiveMemories[0]!;
    expect(item.status).toBe("candidate");
    expect(await engine.cognitiveRecall("отвечай коротко")).toEqual([]);
    await engine.reviewMemory(item.id, "approved");
    await engine.pause(true);
    const restored = new RamoEvolution(store, () => chats, () => 200000);
    expect((await restored.snapshot()).paused).toBe(true);
    expect(await restored.cognitiveRecall("отвечай коротко")).toHaveLength(1);
    const runs = (await restored.snapshot()).runs;
    await restored.run(true);
    expect((await restored.snapshot()).runs).toBe(runs);
  });
});
