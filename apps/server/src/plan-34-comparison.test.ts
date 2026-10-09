import {expect,it} from "vitest";
import {comparePlanVariants} from "./plan-34-comparison";
import type {DraftPlan} from "./plan-25-audit";
const base=():DraftPlan=>({goal:"Inspect",budget:10,deadline:20,availableTools:["search_memory"],
steps:[{id:"a",title:"Read",tool:"search_memory",risk:"read",dependsOn:[],cost:2,minutes:4,approved:false},
{id:"b",title:"Report",risk:"read",dependsOn:["a"],cost:3,minutes:5,approved:false}]});
it("checks 34 stages and chooses safe feasible alternative",()=>{
 const p=base(),alt=base();
 alt.steps[1]!.dependsOn=[];
 const result=comparePlanVariants(p,[alt]);
 expect(result.reviewStages).toBe(34);
 expect(result.candidates).toHaveLength(2);
 expect(result.candidates.every(x=>x.checks.length===9)).toBe(true);
 expect(result.recommendedIndex).toBe(0);
 expect(result.executable).toBe(false);
});
it("rejects invented privileges and tools rather than promoting alternatives",()=>{
 const p=base(),alt=base();
 alt.steps[0]!.approved=true;alt.steps[0]!.risk="danger";alt.steps[0]!.tool="shell";
 const result=comparePlanVariants(p,[alt]);
 expect(result.candidates[1]!.valid).toBe(false);
 expect(result.candidates[1]!.checks.some(x=>x.id==="no_new_privileges"&&!x.passed)).toBe(true);
 expect(result.recommendedIndex).toBe(0);
});
it("does not select any plan if all exceed budget",()=>{
 const p=base();p.budget=1;
 expect(comparePlanVariants(p,[]).recommendedIndex).toBeNull();
});
