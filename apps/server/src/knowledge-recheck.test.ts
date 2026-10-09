import {expect,it} from "vitest";
import {planKnowledgeRecheck} from "./knowledge-recheck";
const nodes=[{id:"a",assertion:"A",dependsOn:[],contradicts:[]},{id:"b",assertion:"B",dependsOn:["a"],contradicts:[]},{id:"c",assertion:"C",dependsOn:["b"],contradicts:[]}];
it("prioritizes critical, unconfirmed dependent knowledge",()=>{
 const result=planKnowledgeRecheck(nodes,"a",[{id:"c",importance:5,evidenceAgeDays:400,confirmed:false}]);
 expect(result.tasks[0]?.id).toBe("c");
 expect(result.tasks).toHaveLength(3);
 expect(result.requiresApproval).toBe(true);
});
it("rejects unrecognized priority settings",()=>{
 expect(()=>planKnowledgeRecheck(nodes,"a",[{id:"missing",importance:3,evidenceAgeDays:0,confirmed:true}])).toThrow();
 expect(()=>planKnowledgeRecheck(nodes,"a",[{id:"a",importance:6,evidenceAgeDays:0,confirmed:true}])).toThrow();
});
