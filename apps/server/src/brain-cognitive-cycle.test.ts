import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("Cognitive Engine 4.1 unified cycle", () => {
  it("observes, executes a single safe step, verifies result and preserves checkpoints", async () => {
    let stored: string | null = null;
    const store={load:async()=>stored,save:async(v:string)=>{stored=v;}};
    const brain=new BrainCore(()=>true,store);
    const plan=brain.plan("Investigate",["Get modules","Inspect memory"]);
    const preview=brain.previewCognitiveCycle(plan.id);
    expect(preview.observation).toMatchObject({progress:0,total:2});
    expect(preview.planning.nextStep?.id).toBe(plan.steps[0]!.id);
    expect(preview.research.requiresSourceCheck).toBe(true);
    let calls=0;
    await expect(brain.runCognitiveCycleStep(plan.id,plan.steps[1]!.id,"list_modules",()=>{calls++;return [];},async()=>[])).rejects.toThrow();
    expect(calls).toBe(0);
    const output=await brain.runCognitiveCycleStep(plan.id,plan.steps[0]!.id,"list_modules",()=>{calls++;return ["ok"];},async()=>[]);
    expect(output.verified).toBe(true);
    expect(output.after.observation.progress).toBe(1);
    expect(output.after.verification.evidence.some(x=>x.stepId===plan.steps[0]!.id)).toBe(true);
    await expect(brain.runCognitiveCycleStep(plan.id,plan.steps[0]!.id,"list_modules",()=>{calls++;return [];},async()=>[])).rejects.toThrow();
    expect(calls).toBe(1);
    const restarted=new BrainCore(()=>true,store);
    await restarted.load();
    expect(restarted.previewCognitiveCycle(plan.id).observation.progress).toBe(1);
  });
  it("fails closed and suggests review after a tool error", async()=>{
    const brain=new BrainCore(()=>true);
    const plan=brain.plan("Investigate",["Inspect"]);
    await expect(brain.runCognitiveCycleStep(plan.id,plan.steps[0]!.id,"search_memory",()=>[],async()=>{throw Error("offline");})).rejects.toThrow("offline");
    const preview=brain.previewCognitiveCycle(plan.id);
    expect(preview.planning.blocked).toBe(true);
    expect(preview.adaptiveRecovery?.needsOwnerReview).toBe(true);
    await expect(brain.runCognitiveCycleStep(plan.id,plan.steps[0]!.id,"search_memory",()=>[],async()=>[])).rejects.toThrow();
  });
});
