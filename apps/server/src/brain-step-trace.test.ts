import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";
describe("plan-scoped execution traces", () => {
  it("isolates step outcomes and includes them in cognitive preview", async () => {
    const brain = new BrainCore(() => true);
    const a = brain.plan("Plan A", ["Read"]);
    const b = brain.plan("Plan B", ["Read"]);
    await brain.executeReadStep(a.id,a.steps[0]!.id,"list_modules",()=>["ok"],async()=>[]);
    brain.updateStep(b.id,b.steps[0]!.id,"active");
    brain.updateStep(b.id,b.steps[0]!.id,"failed");
    expect(brain.stepExecutionTrace(a.id)[0]).toMatchObject({status:"done",verified:true,error:null});
    expect(brain.stepExecutionTrace(b.id)[0]).toMatchObject({status:"failed",verified:false});
    expect(brain.previewCognitiveCycle(a.id).stepTrace[0]?.verified).toBe(true);
    expect(brain.stepExecutionTrace(a.id)[0]?.events.some(e=>e.kind==="failed")).toBe(false);
  });
  it("rejects unknown plans", () => {
    expect(()=>new BrainCore(()=>true).stepExecutionTrace("unknown")).toThrow("План не найден");
  });
});
