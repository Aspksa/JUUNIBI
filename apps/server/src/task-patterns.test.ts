import { expect, it } from "vitest";
import { analyzeTaskPatterns } from "./task-patterns";
import type { DecisionRecord } from "./decision-memory";
const item=(taskType:string,observed:"success"|"failure"|undefined,i:number):DecisionRecord=>({
 id:String(i),at:"2026-10-09",goal:"test",chosen:"plan",reason:"test",predictedSuccess:true,taskType,observed
});
it("detects repeated confirmed failures only in their category",()=>{
 const records=[item("planning","failure",1),item("planning","failure",2),item("planning","failure",3),
   item("planning","success",4),item("math","failure",5),item("math",undefined,6)];
 const result=analyzeTaskPatterns(records);
 expect(result.patterns[0]).toMatchObject({taskType:"planning",confirmed:4,failures:3,successRate:25,repeatedFailure:true});
 expect(result.patterns[1]).toMatchObject({taskType:"math",confirmed:1,failures:1,repeatedFailure:false});
});
it("does not treat missing confirmations as evidence",()=>{
 expect(analyzeTaskPatterns([item("logic",undefined,1)]).patterns).toEqual([]);
});
