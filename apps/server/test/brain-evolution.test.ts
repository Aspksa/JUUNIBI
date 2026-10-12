import {describe,it,expect} from "vitest";
import {inspectExperienceGraph,hybridExperienceSearch,explainStrategyDecision,evaluateBrainEvolutionSuite} from "../src/brain-evolution";
import type {DecisionRecord} from "../src/decision-memory";
const rec=(id:string,chosen:string,outcome?:"success"|"failure"):DecisionRecord=>({
 id,goal:"audit archive",chosen,reason:"test",predictedSuccess:true,at:"2026-01-01",
 taskType:"archive",...(outcome?{observed:outcome,observedAt:"2026-01-02"}:{})
});
describe("Brain Evolution 2.0",()=>{
 const history=[rec("a","inspect","success"),rec("b","inspect","failure"),
   rec("c","delete","failure"),rec("pending","inspect")];
 it("finds explainable graph conflicts and ignores unconfirmed memories",()=>{
   const graph=inspectExperienceGraph(history,"a");
   expect(graph.sourceFound).toBe(true);
   expect(graph.conflicts.some(x=>x.decisionIds.includes("b"))).toBe(true);
   expect(graph.edges.some(x=>x.to==="pending")).toBe(false);
   expect(inspectExperienceGraph(history,"pending").sourceFound).toBe(false);
 });
 it("hybrid search provides lexical, graph and semantic evidence without fabricated decisions",()=>{
   const result=hybridExperienceSearch(history,"audit",{limit:10,taskType:"archive",
     semanticScores:{a:0.9,pending:1}});
   expect(result.items).toHaveLength(3);
   expect(result.items[0].id).toBe("a");
   expect(result.items[0].reasons).toContain("semantic-similarity");
   expect(result.excludedUnconfirmed).toBe(1);
   expect(()=>hybridExperienceSearch(history,"audit",{limit:21})).toThrow();
 });
 it("explains strategies but never executes or activates calibration",()=>{
   const result=explainStrategyDecision({id:"p",goal:"audit archive",createdAt:"2026-01-01",
     status:"planned",steps:[{id:"s",title:"inspect",status:"pending"}]},history,[
     {name:"delete",risk:"high",reversible:false},{name:"inspect",risk:"low",reversible:true}]);
   expect(result.recommended).toBe("inspect");
   expect(result.executesAutomatically).toBe(false);
   expect(result.alternatives.find(x=>x.name==="inspect")?.evidenceIds).not.toContain("pending");
 });
 it("runs integrated deterministic benchmark suite",()=>{
   const suite=evaluateBrainEvolutionSuite();
   expect(suite.passed).toBe(suite.total);
   expect(suite.total).toBeGreaterThanOrEqual(5);
 });
});
