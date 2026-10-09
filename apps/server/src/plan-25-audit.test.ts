import { expect, it } from "vitest";
import { auditDraftPlan, type DraftPlan } from "./plan-25-audit";
const valid=():DraftPlan=>({goal:"Inspect prior failures",budget:10,deadline:20,availableTools:["search_memory"],
 steps:[{id:"inspect",title:"Review local metadata",tool:"search_memory",risk:"read",dependsOn:[],cost:2,minutes:4,approved:false},
 {id:"report",title:"Draft diagnostic report",risk:"read",dependsOn:["inspect"],cost:3,minutes:5,approved:false}]});
it("runs exactly 25 stages on a valid draft without executing tools",()=>{
 const result=auditDraftPlan(valid());
 expect(result.total).toBe(25);
 expect(result.checks).toHaveLength(25);
 expect(result.passed).toBe(25);
 expect(result.failed).toEqual([]);
 expect(result.executable).toBe(false);
 expect(result.requiresRuntimeApproval).toBe(true);
});
it("finds over-budget, unknown tools, missing permission and out-of-order dependencies",()=>{
 const p=valid();p.budget=1;p.steps[0]!.tool="unknown";
 p.steps[0]!.risk="write";p.steps[0]!.approved=false;
 p.steps[0]!.dependsOn=["report"];
 const result=auditDraftPlan(p);
 expect(result.failed).toContain("within_budget");
 expect(result.failed).toContain("requested_tools_available");
 expect(result.failed).toContain("write_requires_approval");
 expect(result.failed).toContain("dependency_order");
});
it("does not allow draft approval to become execution authority",()=>{
 const p=valid();p.steps[0]!.approved=true;p.steps[0]!.risk="danger";
 const result=auditDraftPlan(p);
 expect(result.failed).toEqual([]);
 expect(result.executable).toBe(false);
 expect(result.requiresRuntimeApproval).toBe(true);
});
