import { describe, it, expect } from "vitest";
import { MemoryAdapter } from "@juunibi/assistant";
import { encryptedEvolutionStore } from "./ramo-v6-crypto";
import { memoryGraph, checkMemoryConflicts, runLab, validatePlan, nextPlanSteps, semanticRecall } from "./ramo-v6-core";
import { RamoEvolution } from "./ramo-evolution";
import type { CognitiveMemory } from "./ramo-cognitive";

const memory = (id: string, content: string, status: CognitiveMemory["status"] = "approved"): CognitiveMemory =>
  ({ id, content, status, tier: "semantic", source: "test", confidence: 1, observedAt: 1 });

describe("RAMO Evolution 6", () => {
  it("encrypts authenticated state, migrates legacy plaintext and detects tampering", async () => {
    const inner = new MemoryAdapter();
    await inner.save('{"legacy":true}');
    const key = "a".repeat(64);
    const secure = encryptedEvolutionStore(inner, key);
    expect(await secure.load()).toBe('{"legacy":true}');
    await secure.save('{"secret":"example"}');
    const raw = await inner.load();
    expect(raw).toMatch(/^RAMO6:AES256GCM:/);
    expect(raw).not.toContain("example");
    expect(await secure.load()).toBe('{"secret":"example"}');
    await inner.save(raw!.slice(0, -5) + "AAAAA");
    await expect(secure.load()).rejects.toThrow();
    expect(() => encryptedEvolutionStore(inner, "short")).toThrow();
  });
  it("keeps unapproved memories out of semantic retrieval and falls back if provider fails", async () => {
    const items = [memory("1", "Лиса запоминает важные планы"), memory("2", "Лиса запоминает тайны", "candidate")];
    const provider = { embed: async (s: string) => s.includes("планы") ? [1,0] : [0,1] };
    expect((await semanticRecall(items, "планы", 100, provider)).map(x => x.id)).toEqual(["1"]);
    expect((await semanticRecall(items, "планы", 100, { embed: async () => { throw Error("offline"); } })).map(x => x.id)).toEqual(["1"]);
  });
  it("detects links and runs bounded deterministic experiments", () => {
    const items = [memory("1", "Обсуждаем память проекта"), memory("2", "Улучшаем память проекта")];
    expect(memoryGraph(items).length).toBeGreaterThan(0);
    expect(checkMemoryConflicts(items)).toEqual([]);
    expect(runLab([{ name: "pass", input: "abc", expected: "ok" }], () => "ok").score).toBe(1);
  });
  it("rejects cyclic dependencies and enforces approved plans", async () => {
    const a = { id: "a", title: "Начало", status: "pending" as const, dependsOn: [] };
    const b = { id: "b", title: "Конец", status: "pending" as const, dependsOn: ["a"] };
    expect(validatePlan([a,b])).toBe(true);
    expect(nextPlanSteps([a,b]).map(x=>x.id)).toEqual(["a"]);
    expect(validatePlan([{...a, dependsOn:["b"]}, b])).toBe(false);
    const store = new MemoryAdapter();
    const chats = [{ id: "c", messages: [{ role: "user", content: "Хочу сделать большой проект" }] }];
    const engine = new RamoEvolution(store, () => chats, () => 100_000);
    await engine.configure({ enabled: true });
    await engine.run(true);
    const goal = (await engine.snapshot()).goals[0]!;
    await expect(engine.createPlan(goal.id, [a,b])).rejects.toThrow();
    await engine.setGoal(goal.id, "approved");
    await engine.createPlan(goal.id, [a,b]);
    const plan = (await engine.snapshot()).plans[0]!;
    await expect(engine.completeStep(plan.id, "b")).rejects.toThrow();
    await engine.completeStep(plan.id, "a");
    await engine.completeStep(plan.id, "b");
    const restarted = new RamoEvolution(store, () => chats, () => 200_000);
    expect((await restarted.snapshot()).schemaVersion).toBe(6);
    expect((await restarted.snapshot()).plans[0]!.steps.every(x => x.status === "done")).toBe(true);
  });
});
