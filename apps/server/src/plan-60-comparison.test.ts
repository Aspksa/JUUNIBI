import {expect,it} from "vitest";
import {comparePlanVariants} from "./plan-34-comparison";
import type {DraftPlan} from "./plan-25-audit";
const base=():DraftPlan=>({goal:"Safe planning",budget:100,deadline:100,availableTools:["search_memory"],steps:[
{id:"a",title:"Inspect",tool:"search_memory",risk:"read",dependsOn:[],cost:1,minutes:1,approved:false},
{id:"b",title:"Summarize",risk:"read",dependsOn:["a"],cost:1,minutes:1,approved:false}
]});
it("checks exactly sixty variants with 34 safety checks each",()=>{
 const p=base();const alternatives=Array.from({length:59},()=>base());
 const result=comparePlanVariants(p,alternatives);
 expect(result.comparedPlans).toBe(60);
 expect(result.candidates).toHaveLength(60);
 expect(result.candidates.every(x=>x.audit.checks.length===25&&x.checks.length===9)).toBe(true);
 expect(result.recommendedIndex).toBe(0);
 expect(result.executable).toBe(false);
});
it("rejects over sixty variants and oversized batches",()=>{
 const p=base();
 expect(()=>comparePlanVariants(p,Array.from({length:60},()=>base()))).toThrow();
 const oversized=base();oversized.goal="z".repeat(260000);
 expect(()=>comparePlanVariants(oversized,[])).toThrow();
});
it("refuses to rank a privileged alternative even among sixty",()=>{
 const p=base();const a=Array.from({length:59},()=>base());
 a[5]!.steps[0]!.risk="danger";
 const result=comparePlanVariants(p,a);
 expect(result.candidates[6]!.valid).toBe(false);
 expect(result.recommendedIndex).toBe(0);
});
