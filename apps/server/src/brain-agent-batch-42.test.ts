import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("Cognitive Engine 4.2 bounded agent", () => {
  it("executes only approved steps and skips completed steps after restart", async () => {
    let state: string | null = null;
    const storage={load:async()=>state,save:async(s:string)=>{state=s;}};
    const brain=new BrainCore(()=>true,storage);
    const plan=brain.plan("Check",["First","Second","Third"]);
    let runs=0;
    await expect(brain.executeAgentBatch(plan.id,["list_modules"],6,()=>{runs++;return [];},async()=>[])).rejects.toThrow();
    expect(runs).toBe(0);
    const first=await brain.executeAgentBatch(plan.id,["list_modules","search_memory"],2,()=>{runs++;return ["ok"];},async()=>{runs++;return ["found"];});
    expect(first.completed).toHaveLength(2);
    expect(first.remaining).toBe(1);
    expect(first.verifiedStepIds).toContain(plan.steps[0]!.id);
    const restarted=new BrainCore(()=>true,storage);
    await restarted.load();
    const second=await restarted.executeAgentBatch(plan.id,["list_modules"],1,()=>{runs++;return ["ok"];},async()=>[]);
    expect(second.skippedPreviouslyCompleted).toBe(2);
    expect(second.remaining).toBe(0);
    expect(runs).toBe(3);
  });
  it("fails closed at first error and blocks replay without review", async () => {
    const brain=new BrainCore(()=>true);
    const plan=brain.plan("Inspect",["A","B"]);
    let runs=0;
    await expect(brain.executeAgentBatch(plan.id,["list_modules","search_memory"],2,
      ()=>{runs++;return ["ok"];},async()=>{runs++;throw new Error("offline");})).rejects.toThrow("offline");
    expect(runs).toBe(2);
    expect(brain.status().plans.find(p=>p.id===plan.id)?.steps.map(s=>s.status)).toEqual(["done","failed"]);
    await expect(brain.executeAgentBatch(plan.id,["list_modules"],1,()=>{runs++;return [];},async()=>[])).rejects.toThrow();
    expect(runs).toBe(2);
  });
});
