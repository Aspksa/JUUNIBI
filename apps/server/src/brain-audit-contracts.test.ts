import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("audit regressions", () => {
  it("rejects wrong-shaped tool outputs instead of verifying them", async () => {
    const brain=new BrainCore(()=>true);
    const plan=brain.plan("Inspect",["Read modules"]);
    await expect(brain.executeReadStep(plan.id,plan.steps[0]!.id,"list_modules",()=>({error:"bad"}),async()=>[])).rejects.toThrow("проверяемый результат");
    expect(brain.status().plans.find(p=>p.id===plan.id)?.status).toBe("failed");
  });
  it("surfaces failed writes to the caller",async()=>{
    const brain=new BrainCore(()=>true,{load:async()=>null,save:async()=>{throw new Error("disk full");}});
    brain.plan("Check",["Run"]);
    await expect(brain.verifyPersistence()).rejects.toThrow("disk full");
  });
});
