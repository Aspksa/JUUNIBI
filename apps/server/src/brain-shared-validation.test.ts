import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("shared execution preflight", () => {
  it("rejects disallowed actions before running any step in both executors", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("Audit", ["One", "Two"]);
    let calls = 0;
    await expect(brain.resumeReadSequence(plan.id, ["list_modules", "shell"], () => { calls++; return []; }, async () => [])).rejects.toThrow();
    await expect(brain.executeAgentBatch(plan.id, ["list_modules", "shell"], 2, () => { calls++; return []; }, async () => [])).rejects.toThrow();
    expect(calls).toBe(0);
    expect(brain.status().plans.find(p=>p.id===plan.id)?.steps.every(s=>s.status==="pending")).toBe(true);
  });
  it("does not replay completed work on resume or batch", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("Audit", ["One", "Two", "Three"]);
    let count = 0;
    await brain.runCognitiveCycleStep(plan.id, plan.steps[0]!.id, "list_modules", () => { count++; return []; }, async () => []);
    const result=await brain.resumeReadSequence(plan.id, ["list_modules","list_modules"], () => { count++; return []; }, async () => []);
    expect(result.skippedCompleted).toBe(1);
    expect(count).toBe(3);
  });
});
