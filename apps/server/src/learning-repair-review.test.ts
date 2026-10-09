import {expect,it} from "vitest";
import {reviewLearningCase} from "./learning-repair-review";
import type {DecisionRecord} from "./decision-memory";
const sample={id:"case1",taskType:"planning",symptoms:["timeout","budget"],
 candidateFixes:[{id:"safe",title:"Safe fix",cost:5,risk:10,coveredSymptoms:["timeout","budget"]},
 {id:"risky",title:"Risky fix",cost:1,risk:90,coveredSymptoms:["timeout"]}],
 checks:[{id:"c1",fixId:"safe",passed:true,verified:true},{id:"c2",fixId:"risky",passed:true,verified:true}]};
const record=(n:number):DecisionRecord=>({id:String(n),at:"2026-01-01",goal:"goal",chosen:"x",reason:"test",taskType:"planning",predictedSuccess:true,observed:"failure"});
it("uses ten steps, rejects risky strategies and requires approval",()=>{
 const result=reviewLearningCase(sample,[record(1),record(2),record(3)]);
 expect(result.stages).toHaveLength(10);
 expect(result.history.repeated).toBe(true);
 expect(result.recommendedId).toBe("safe");
 expect(result.fixes.find(x=>x.id==="risky")?.eligible).toBe(false);
 expect(result.requiresApproval).toBe(true);
});
it("does not treat unverified checks as proof",()=>{
 const result=reviewLearningCase({...sample,checks:[{id:"c1",fixId:"safe",passed:true,verified:false}]},[]);
 expect(result.recommendedId).toBeNull();
});
it("blocks previously failed fixes and invalid identifiers",()=>{
 const x=reviewLearningCase({...sample,checks:[...sample.checks,{id:"c3",fixId:"safe",passed:false,verified:true}]},[]);
 expect(x.recommendedId).toBeNull();
 expect(()=>reviewLearningCase({...sample,id:"!"},[])).toThrow();
});
