import { describe, expect, it } from "vitest";
import { MemoryAdapter } from "@juunibi/assistant";
import { classifyExperience, retrieveMemories, evaluateDialogue } from "./ramo-cognitive";
import { RamoEvolution, retainMemories } from "./ramo-evolution";
import { checkMemoryConflicts, validatePlan } from "./ramo-v6-core";

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
  it("preserves approved knowledge when memory is full", () => {
    const base = classifyExperience({ id: "a", kind: "preference", text: "Отвечай кратко на вопросы", source: "chat", confidence: 1, createdAt: 1 });
    const approved = { ...base, status: "approved" as const };
    const candidates = Array.from({ length: 500 }, (_, i) => ({ ...base, id: "candidate-" + i }));
    const retained = retainMemories([approved, ...candidates]);
    expect(retained).toHaveLength(500);
    expect(retained.some(x => x.id === "a")).toBe(true);
    expect(retained.some(x => x.id === "candidate-0")).toBe(false);
  });
  it("detects Russian negation and rejects malformed plan dependencies", () => {
    const base = classifyExperience({ id: "a", kind: "decision", text: "Я выбираю краткие ответы", source: "chat", confidence: 1, createdAt: 1 });
    const a = { ...base, status: "approved" as const };
    const b = { ...a, id: "b", content: "Я не выбираю краткие ответы" };
    expect(checkMemoryConflicts([a, b])).toEqual([{ first: "a", second: "b" }]);
    expect(validatePlan([{ id: "x", title: "Step", status: "pending", dependsOn: null } as unknown as Parameters<typeof validatePlan>[0][number]])).toBe(false);
  });
  it("flags empty assistant answers", () => {
    expect(evaluateDialogue([{ role: "assistant", content: " " }]).failures.some(x => x.name === "empty-assistant")).toBe(true);
  });
  it("uses semantic embeddings for approved memories when provided", async () => {
    const store = new MemoryAdapter();
    const seed = new RamoEvolution(store, () => []);
    const state = await seed.snapshot();
    state.cognitiveMemories = [
      { id: "a", tier: "semantic", content: "яблоко", source: "chat", confidence: 1, observedAt: 1, status: "approved" },
      { id: "b", tier: "semantic", content: "машина", source: "chat", confidence: 1, observedAt: 1, status: "candidate" },
    ];
    await store.save(JSON.stringify(state));
    const provider = { embed: async (value: string) => value === "fruit" || value === "яблоко" ? [1, 0] : [0, 1] };
    const engine = new RamoEvolution(store, () => [], () => 1000, provider);
    expect((await engine.cognitiveRecall("fruit")).map(x => x.id)).toEqual(["a"]);
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
