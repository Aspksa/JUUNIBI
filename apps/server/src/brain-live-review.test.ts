import { expect, it } from "vitest";
import { BrainCore } from "./brain";

const reviewFor = (stepIds: string[]) => ({
 claims: [{id:"claim",proposition:"A documented task",stance:"true" as const,evidenceIds:["source"],dependsOn:[]}],
 evidence: [{id:"source",verified:true}],
 knowledge: [{id:"claim",assertion:"A documented task",dependsOn:[],contradicts:[]}],
 changedId: "claim",
 priorities: [{id:"claim",importance:3,evidenceAgeDays:0,confirmed:true}],
 limits: {budget:10,deadline:10,maxRisk:10,available:[],resources:{}},
 estimates: stepIds.map(stepId=>({stepId,cost:1,duration:1,risk:1,benefit:2,requires:[],effects:[]}))
});
it("reviews persisted real task steps in their original order without executing",()=>{
 const brain=new BrainCore(()=>true);
 const plan=brain.plan("Review project",["Read current modules","Check remembered outcomes"]);
 const result=brain.previewActivePlan(plan.id,reviewFor(plan.steps.map(s=>s.id)));
 expect(result.steps.map(s=>s.title)).toEqual(["Read current modules","Check remembered outcomes"]);
 expect(result.review.plan.completed).toEqual(["step_0","step_1"]);
 expect(result.review.readyForHumanReview).toBe(true);
 expect(result.requiresApproval).toBe(true);
 expect(brain.status().plans[0]?.steps.every(s=>s.status==="pending")).toBe(true);
});
it("does not accept missing, duplicate or unrelated task estimates",()=>{
 const brain=new BrainCore(()=>true);
 const plan=brain.plan("Task",["One","Two"]);
 const ids=plan.steps.map(s=>s.id);
 expect(()=>brain.previewActivePlan(plan.id,reviewFor(ids.slice(0,1)))).toThrow();
 expect(()=>brain.previewActivePlan(plan.id,reviewFor([ids[0]!,ids[0]!]))).toThrow();
 expect(()=>brain.previewActivePlan("missing",reviewFor(ids))).toThrow();
});
it("retains constraints supplied by owner and blocks infeasible budgets",()=>{
 const brain=new BrainCore(()=>true);
 const plan=brain.plan("Task",["First"]);
 const request=reviewFor(plan.steps.map(s=>s.id));
 const result=brain.previewActivePlan(plan.id,{...request,limits:{...request.limits,budget:0}});
 expect(result.review.readyForHumanReview).toBe(false);
 expect(result.review.blockers).toContain("План не удовлетворяет ограничениям");
});
