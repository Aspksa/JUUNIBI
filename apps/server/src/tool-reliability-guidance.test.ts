import { expect, it } from "vitest";
import { toolReliabilityGuidance } from "./tool-reliability-guidance";
import type { ToolObservation } from "./tool-failure-patterns";
const observation=(tool:string,status:ToolObservation["status"]):ToolObservation=>({tool,status,risk:"read",elapsedMs:5,at:"2026-10-09T00:00:00.000Z"});
it("warns on recurring execution errors without blocking tools",()=>{
 const advice=toolReliabilityGuidance([observation("search","error"),observation("search","error"),observation("search","ok")]);
 expect(advice).toHaveLength(1);
 expect(advice[0]?.caution).toBe(true);
 expect(advice[0]?.errors).toBe(2);
 expect(advice[0]?.guidance).toContain("Проверь");
});
it("distinguishes owner denials from errors and ignores successes",()=>{
 const advice=toolReliabilityGuidance([observation("write","denied"),observation("write","denied"),observation("read","ok")]);
 expect(advice).toHaveLength(1);
 expect(advice[0]?.denied).toBe(2);
 expect(advice[0]?.errors).toBe(0);
 expect(advice[0]?.caution).toBe(false);
});
it("bounds output and rejects malformed tool identifiers",()=>{
 const many=Array.from({length:50},(_,i)=>observation("tool_"+i,"error")).flatMap(x=>[x,x]);
 const result=toolReliabilityGuidance([...many,{...observation("bad tool","error")}]);
 expect(result).toHaveLength(8);
 expect(result.every(x=>x.tool!=="bad tool")).toBe(true);
});
