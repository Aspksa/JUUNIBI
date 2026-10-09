import { expect, it } from "vitest";
import { proposePlanRepair } from "./plan-repair";
import type { DraftPlan } from "./plan-25-audit";
const draft=():DraftPlan=>({goal:"Verify safe plan",budget:20,deadline:30,availableTools:["search_memory"],
 steps:[{id:"b",title:"Final summary",risk:"read",cost:2,minutes:4,approved:false,dependsOn:["a"]},
 {id:"a",title:"Inspect local metadata",risk:"read",tool:"search_memory",cost:3,minutes:5,approved:false,dependsOn:[]}]});
it("topologically reorders a valid plan and rechecks all 25 stages",()=>{
 const original=draft(),result=proposePlanRepair(original);
 expect(result.original.failed).toContain("dependency_order");
 expect(result.candidate.steps.map(x=>x.id)).toEqual(["a","b"]);
 expect(result.reassessed.passed).toBe(25);
 expect(result.improved).toBe(true);
 expect(original.steps[0]?.id).toBe("b");
 expect(result.executable).toBe(false);
});
it("does not fabricate approvals, tool access or resources",()=>{
 const p=draft();p.budget=1;p.steps[0]!.risk="danger";p.steps[0]!.approved=false;
 p.steps[0]!.tool="missing";
 const result=proposePlanRepair(p);
 expect(result.remaining).toContain("within_budget");
 expect(result.remaining).toContain("danger_requires_approval");
 expect(result.remaining).toContain("requested_tools_available");
 expect(result.candidate.steps.find(x=>x.id==="b")?.approved).toBe(false);
});
it("preserves dependency cycles for owner review",()=>{
 const p=draft();p.steps[1]!.dependsOn=["b"];
 const result=proposePlanRepair(p);
 expect(result.remaining).toContain("dependency_order");
 expect(result.executable).toBe(false);
});
