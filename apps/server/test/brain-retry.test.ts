import { describe, expect, it } from "vitest";
import { BrainCore } from "../src/brain";

describe("brain safe retries", () => {
  it("retries only the failed step and keeps completed steps intact", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("inspect", ["modules", "memory", "finish"]);
    await brain.executeReadStep(plan.id, plan.steps[0]!.id, "list_modules", () => ["ok"], async () => []);
    await expect(brain.executeReadStep(plan.id, plan.steps[1]!.id, "search_memory", () => [], async () => { throw Error("offline"); })).rejects.toThrow("offline");
    const result = await brain.retryFailedReadStep(plan.id, plan.steps[1]!.id, "search_memory", () => [], async () => ["restored"]);
    expect(result.result).toEqual(["restored"]);
    expect(brain.status().plans[0]?.steps.map(s => s.status)).toEqual(["done", "done", "pending"]);
    expect(brain.status().plans[0]?.steps[1]?.retries).toBe(1);
  });
  it("refuses unsafe tools and bounds repeated failures", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("inspect", ["memory"]);
    const fail = async () => { throw Error("offline"); };
    await expect(brain.executeReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], fail)).rejects.toThrow("offline");
    await expect(brain.retryFailedReadStep(plan.id, plan.steps[0]!.id, "shell", () => [], fail)).rejects.toThrow("безопасного чтения");
    for (let i = 0; i < 2; i++) await expect(brain.retryFailedReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], fail)).rejects.toThrow("offline");
    await expect(brain.retryFailedReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], fail)).rejects.toThrow("лимит повторов");
  });
  it("preserves retry budget across restart", async () => {
    let raw: string | null = null;
    const store = { load: async () => raw, save: async (s: string) => { raw = s; } };
    const first = new BrainCore(() => true, store);
    const plan = first.plan("inspect", ["memory"]);
    const fail = async () => { throw Error("offline"); };
    await expect(first.executeReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], fail)).rejects.toThrow();
    await expect(first.retryFailedReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], fail)).rejects.toThrow();
    await first.flush();
    const restored = new BrainCore(() => true, store);
    await restored.load();
    expect(restored.status().plans[0]?.steps[0]?.retries).toBe(1);
  });
});
