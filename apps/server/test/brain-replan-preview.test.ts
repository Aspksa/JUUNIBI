import { describe, expect, it } from "vitest";
import { BrainCore } from "../src/brain";

describe("brain recovery preview", () => {
  it("proposes only remaining safe steps and does not mutate or execute", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("audit", ["modules", "memory", "status"]);
    await brain.executeReadStep(plan.id, plan.steps[0]!.id, "list_modules", () => ["ok"], async () => []);
    await expect(brain.executeReadStep(plan.id, plan.steps[1]!.id, "search_memory", () => [], async () => { throw Error("offline"); })).rejects.toThrow("offline");
    const before = brain.status().plans[0];
    const recovery = brain.previewRecovery(plan.id, plan.steps[1]!.id, ["list_modules", "search_memory"]);
    expect(recovery.completedSteps.map(s => s.id)).toEqual([plan.steps[0]!.id]);
    expect(recovery.proposedSteps.map(s => s.action)).toEqual(["list_modules", "search_memory"]);
    expect(recovery.reason).toBe("offline");
    expect(recovery.requiresExplicitExecution).toBe(true);
    expect(brain.status().plans[0]).toEqual(before);
  });

  it("rejects unsafe alternatives and missing steps before execution", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("audit", ["memory"]);
    await expect(brain.executeReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], async () => { throw Error("offline"); })).rejects.toThrow();
    expect(() => brain.previewRecovery(plan.id, plan.steps[0]!.id, ["shell"])).toThrow("безопасного чтения");
    expect(() => brain.previewRecovery(plan.id, plan.steps[0]!.id, [])).toThrow("безопасного чтения");
    expect(brain.status().plans[0]?.steps[0]?.status).toBe("failed");
  });

  it("refuses recovery preview after exhausting retries", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("audit", ["memory"]);
    const fail = async () => { throw Error("offline"); };
    await expect(brain.executeReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], fail)).rejects.toThrow();
    for (let n = 0; n < 2; n++) await expect(brain.retryFailedReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], fail)).rejects.toThrow();
    expect(() => brain.previewRecovery(plan.id, plan.steps[0]!.id, ["search_memory"])).toThrow("лимит повторов");
  });
});
