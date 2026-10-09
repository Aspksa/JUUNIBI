import {expect,it} from "vitest";
import {assessKnowledgeImpact} from "./knowledge-impact";
const nodes=[
 {id:"a",assertion:"Initial",dependsOn:[],contradicts:["d"]},
 {id:"b",assertion:"First consequence",dependsOn:["a"],contradicts:[]},
 {id:"c",assertion:"Second consequence",dependsOn:["b"],contradicts:["d"]},
 {id:"d",assertion:"Opposing claim",dependsOn:[],contradicts:["a"]}];
it("traces transitive dependencies and contradictory neighbors",()=>{
 const r=assessKnowledgeImpact(nodes,"a");
 expect(r.impacted).toEqual([{id:"b",depth:1,reason:expect.any(String)},{id:"c",depth:2,reason:expect.any(String)}]);
 expect(r.contradictions).toHaveLength(2);
 expect(r.requiresApproval).toBe(true);
});
it("rejects unknown nodes, duplicates and broken references",()=>{
 expect(()=>assessKnowledgeImpact(nodes,"missing")).toThrow();
 expect(()=>assessKnowledgeImpact([nodes[0]!,nodes[0]!],"a")).toThrow();
 expect(()=>assessKnowledgeImpact([{...nodes[0]!,dependsOn:["missing"]}],"a")).toThrow();
});
it("handles cycles in dependencies without running indefinitely",()=>{
 const r=assessKnowledgeImpact([{id:"x",assertion:"X",dependsOn:["y"],contradicts:[]},{id:"y",assertion:"Y",dependsOn:["x"],contradicts:[]}],"x");
 expect(r.affectedCount).toBe(1);
});
