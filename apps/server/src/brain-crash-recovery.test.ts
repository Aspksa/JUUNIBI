import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("crash-safe brain checkpoints", () => {
  it("does not automatically replay an interrupted active step after reload",async()=>{
    let saved: string|null=null;
    const store={load:async()=>saved,save:async(s:string)=>{saved=s;}};
    const before=new BrainCore(()=>true,store);
    const plan=before.plan("Audit",["Inspect"]);
    before.updateStep(plan.id,plan.steps[0]!.id,"active");
    await before.flush();
    const after=new BrainCore(()=>true,store);
    await after.load();
    expect(after.status().plans.find(p=>p.id===plan.id)?.status).toBe("failed");
    expect(after.status().plans.find(p=>p.id===plan.id)?.steps[0]?.lastError).toMatch(/прервано/);
    await expect(after.executeAgentBatch(plan.id,["list_modules"],1,()=>[],async()=>[])).rejects.toThrow();
  });
  it("persists active status before touching a tool and verified result before success",async()=>{
    let saved: string|null=null;
    const snapshots:string[]=[];
    const store={load:async()=>saved,save:async(s:string)=>{saved=s;snapshots.push(s);}};
    const brain=new BrainCore(()=>true,store);
    const plan=brain.plan("Audit",["Inspect"]);
    const result=await brain.executeReadStep(plan.id,plan.steps[0]!.id,"list_modules",()=>{
      expect(JSON.parse(saved!)?.plans[0].steps[0].status).toBe("active");
      return ["ok"];
    },async()=>[]);
    expect(result.result).toEqual(["ok"]);
    expect(JSON.parse(saved!)?.plans[0].steps[0].status).toBe("done");
    expect(JSON.parse(saved!)?.logs.some((l:{outcome:string})=>l.outcome.startsWith("verified:"))).toBe(true);
  });
  it("blocks the tool when the active checkpoint could not be saved",async()=>{
    const brain=new BrainCore(()=>true,{load:async()=>null,save:async()=>{throw Error("disk full");}});
    const plan=brain.plan("Audit",["Inspect"]);
    let called=false;
    await expect(brain.executeReadStep(plan.id,plan.steps[0]!.id,"list_modules",()=>{called=true;return []},async()=>[])).rejects.toThrow("disk full");
    expect(called).toBe(false);
  });
});
