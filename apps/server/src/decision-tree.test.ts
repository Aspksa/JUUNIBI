import {it,expect} from "vitest";
import {evaluateDecisionTree,type DecisionBranch} from "./decision-tree";
import type {PlanLimits} from "./plan-evaluator";
const limits:PlanLimits={budget:100,deadline:10,maxRisk:20,available:["network"],resources:{power:5}};
const step=(id:string,cost:number)=>({id,title:id,cost,duration:2,risk:2,benefit:10,requires:["network"],after:[],effects:[{resource:"power",delta:-2}]});
const branches:DecisionBranch[]=[{id:"main",priority:5,steps:[step("main-step",70)]},{id:"backup",priority:3,steps:[step("backup-step",30)]}];
it("selects highest priority feasible plan and switches on new budget",()=>{
 expect(evaluateDecisionTree(branches,limits).selectedId).toBe("main");
 const v=evaluateDecisionTree(branches,limits,{id:"budget-cut",budgetDelta:-50});
 expect(v.selectedId).toBe("backup");
 expect(v.alternativeIds).toEqual([]);
 expect(v.requiresApproval).toBe(true);
 expect(limits.budget).toBe(100);
});
it("reports no feasible plan if prerequisite disappears",()=>{
 const v=evaluateDecisionTree(branches,limits,{id:"offline",unavailable:["network"]});
 expect(v.selectedId).toBeNull();
 expect(v.branches.every(b=>!b.feasible)).toBe(true);
});
it("rejects malformed events and overlapping branch identifiers",()=>{
 expect(()=>evaluateDecisionTree([branches[0]!,branches[0]!],limits)).toThrow();
 expect(()=>evaluateDecisionTree(branches,limits,{id:"bad",resourceDeltas:{unknown:3}})).toThrow();
});
