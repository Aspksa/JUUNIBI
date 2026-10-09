import {describe,it,expect} from "vitest";
import {evaluateOptions,type PlanLimits,type PlanOption} from "./plan-evaluator";
const limits:PlanLimits={budget:100,deadline:10,maxRisk:30,available:["network"],resources:{energy:5}};
const options:PlanOption[]=[
{id:"fast",title:"Быстро",cost:80,duration:2,risk:10,benefit:120,requires:["network"],effects:[{resource:"energy",delta:-3}]},
{id:"cheap",title:"Дёшево",cost:20,duration:8,risk:15,benefit:50,requires:[],effects:[]},
{id:"unsafe",title:"Рискованно",cost:10,duration:1,risk:90,benefit:500,requires:[],effects:[]}
];
describe("Brain 4.6 planning evaluation",()=>{
 it("rejects infeasible plans and recommends feasible alternative without execution",()=>{
 const result=evaluateOptions(options,limits);
 expect(result.recommendedId).toBe("fast");
 expect(result.requiresApproval).toBe(true);
 expect(result.assessments.find(x=>x.id==="unsafe")).toMatchObject({feasible:false,score:null});
 expect(result.assessments.find(x=>x.id==="fast")?.resultingResources.energy).toBe(2);
 expect(limits.resources.energy).toBe(5);
 });
 it("rejects unmet dependencies, insufficient resources and invalid input",()=>{
 const altered=structuredClone(options);
 altered[0]!.effects=[{resource:"energy",delta:-10}];
 expect(evaluateOptions(altered,limits).assessments[0]!.blockers).toContain("Недостаточно ресурса: energy");
 expect(()=>evaluateOptions([{...options[0]!,cost:Infinity}],limits)).toThrow();
 expect(()=>evaluateOptions([options[0]!,options[0]!],limits)).toThrow();
 });
 it("returns no recommendation when every option fails",()=>{
 const out=evaluateOptions(options,{...limits,budget:0,maxRisk:0});
 expect(out.recommendedId).toBeNull();
 });
});
