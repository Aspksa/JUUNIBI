import { expect, it } from "vitest";
import { compareRobustStrategies } from "./robust-strategies";
import type { SequenceStep } from "./sequence-simulator";
import type { PlanLimits } from "./plan-evaluator";
const limits:PlanLimits={budget:100,deadline:10,maxRisk:20,available:[],resources:{energy:10}};
const a:SequenceStep={id:"a",title:"A",after:[],cost:40,duration:4,risk:2,benefit:10,requires:[],effects:[{resource:"energy",delta:-3}]};
const b:SequenceStep={id:"b",title:"B",after:["a"],cost:70,duration:5,risk:2,benefit:10,requires:[],effects:[{resource:"energy",delta:-3}]};
it("compares baseline and stressed repairs without mutation",()=>{
 const steps=[a,b];
 const result=compareRobustStrategies(steps,limits);
 expect(result.initial.feasible).toBe(false);
 expect(result.strategies.length).toBeGreaterThan(1);
 expect(result.strategies[0]!.scenarios).toHaveLength(4);
 expect(result.strategies.find(x=>x.id==="repair-1")?.baselineFeasible).toBe(true);
 expect(result.requiresApproval).toBe(true);
 expect(b.cost).toBe(70);
 expect(limits.resources.energy).toBe(10);
});
it("does not recommend infeasible alternatives",()=>{
 const result=compareRobustStrategies([{...a,risk:50}],limits);
 expect(result.recommendedId).toBeNull();
 expect(result.strategies[0]!.feasibleScenarios).toBe(0);
});
