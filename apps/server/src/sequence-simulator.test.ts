import { expect, it } from "vitest";
import { simulateSequence, type SequenceStep } from "./sequence-simulator";
import type { PlanLimits } from "./plan-evaluator";
const limits: PlanLimits = { budget:100, deadline:10, maxRisk:30, available:[], resources:{energy:5} };
const a:SequenceStep={id:"a",title:"Step A",after:[],cost:40,duration:4,risk:5,benefit:5,requires:[],effects:[{resource:"energy",delta:-2}]};
const b:SequenceStep={id:"b",title:"Step B",after:["a"],cost:50,duration:5,risk:5,benefit:5,requires:[],effects:[{resource:"energy",delta:-2}]};
it("simulates cumulative time, money and resources without mutating inputs",()=>{
 const result=simulateSequence([a,b],limits);
 expect(result).toMatchObject({feasible:true,completed:["a","b"],remainingBudget:10,remainingTime:1,resources:{energy:1},requiresApproval:true});
 expect(limits.resources.energy).toBe(5);
});
it("stops at the first failed step, preserving previous results",()=>{
 const result=simulateSequence([a,{...b,cost:80}],limits);
 expect(result).toMatchObject({feasible:false,failedAt:"b",completed:["a"],remainingBudget:60});
 expect(result.blockers).toContain("Превышен бюджет");
});
it("rejects out-of-order, unknown and circular dependencies",()=>{
 expect(simulateSequence([b,a],limits).blockers).toContain("Не завершён шаг: a");
 expect(()=>simulateSequence([a,{...b,after:["missing"]}],limits)).toThrow();
 expect(()=>simulateSequence([{...a,after:["b"]},b],limits)).toThrow;
 expect(()=>simulateSequence([a,a],limits)).toThrow();
});
