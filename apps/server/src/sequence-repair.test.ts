import { expect, it } from "vitest";
import { suggestSequenceRepairs } from "./sequence-repair";
import type { SequenceStep } from "./sequence-simulator";
import type { PlanLimits } from "./plan-evaluator";
const limits: PlanLimits = { budget: 50, deadline: 5, maxRisk: 20, available: [], resources: { energy: 3 } };
const a: SequenceStep = { id:"a",title:"A",cost:20,duration:2,risk:1,benefit:10,requires:[],after:[],effects:[] };
const b: SequenceStep = { id:"b",title:"B",cost:40,duration:2,risk:1,benefit:10,requires:[],after:["a"],effects:[] };
it("suggests a cheaper plan without executing or mutating input",()=>{
 const original = [a,b]; const result=suggestSequenceRepairs(original,limits);
 expect(result.original.failedAt).toBe("b");
 expect(result.suggestions[0]).toMatchObject({type:"reduce-cost",feasible:true});
 expect(result.suggestions[0]!.candidate[1]!.cost).toBe(30);
 expect(original[1]!.cost).toBe(40);
 expect(result.requiresApproval).toBe(true);
});
it("suggests resource and deadline repairs, keeping hard constraints",()=>{
 const expensive:SequenceStep={...a,cost:1,duration:6,effects:[]};
 expect(suggestSequenceRepairs([expensive],limits).suggestions[0]!.type).toBe("reduce-duration");
 const depleted:SequenceStep={...a,cost:1,duration:1,effects:[{resource:"energy",delta:-5}]};
 expect(suggestSequenceRepairs([depleted],limits).suggestions[0]!.candidate[0]!.effects[0]!.delta).toBe(-3);
});
it("returns no unnecessary repairs for a valid sequence",()=>{
 expect(suggestSequenceRepairs([a],limits).suggestions).toEqual([]);
});
