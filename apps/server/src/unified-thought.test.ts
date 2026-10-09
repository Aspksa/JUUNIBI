import { expect, it } from "vitest";
import { previewUnifiedThought } from "./unified-thought";
const base={
 claims:[{id:"a",proposition:"Evidence applies",stance:"true" as const,evidenceIds:["source"],dependsOn:[]}],
 evidence:[{id:"source",verified:true}],
 knowledge:[{id:"a",assertion:"Evidence applies",dependsOn:[],contradicts:[]}],
 changedId:"a",priorities:[{id:"a",importance:5,evidenceAgeDays:2,confirmed:true}],
 steps:[{id:"step",title:"Review",cost:1,duration:1,risk:1,benefit:2,requires:[],effects:[],after:[]}],
 limits:{budget:10,deadline:10,maxRisk:10,available:[],resources:{}}
};
it("combines existing brain checks without executing",()=>{
 const result=previewUnifiedThought(base);
 expect(result.stages).toHaveLength(5);
 expect(result.readyForHumanReview).toBe(true);
 expect(result.requiresApproval).toBe(true);
 expect(result.plan.feasible).toBe(true);
});
it("blocks a plan that fails budget constraints",()=>{
 const result=previewUnifiedThought({...base,limits:{...base.limits,budget:0}});
 expect(result.readyForHumanReview).toBe(false);
 expect(result.blockers).toContain("План не удовлетворяет ограничениям");
});
it("blocks contradictory assertions",()=>{
 const result=previewUnifiedThought({...base,claims:[...base.claims,{...base.claims[0]!,id:"b",stance:"false" as const}]});
 expect(result.readyForHumanReview).toBe(false);
 expect(result.logic.conflicts).toHaveLength(1);
});
