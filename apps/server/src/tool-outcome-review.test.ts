import {expect,it} from "vitest";
import {reviewToolOutcome} from "./tool-outcome-review";
import {BrainCore} from "./brain";
it("recognizes exact reported outcomes without writing memory",()=>{
 const brain=new BrainCore(()=>true);
 const result=brain.reviewToolOutcome({tool:"search_memory",expected:"found",actual:"found",status:"ok"});
 expect(result.matchesExpectation).toBe(true);
 expect(result.requiresOwnerConfirmation).toBe(true);
 expect(brain.decisionHistory().records).toHaveLength(0);
});
it("flags error, denial and different actual results",()=>{
 for(const status of ["error","denied","ok"] as const){
  const r=reviewToolOutcome({tool:"lookup",expected:"found",actual:"missing",status});
  expect(r.matchesExpectation).toBe(false);
  expect(r.discrepancy).toBeTruthy();
 }
});
it("rejects malformed evidence",()=>{
 expect(()=>reviewToolOutcome({tool:"",expected:"x",actual:"y",status:"ok"})).toThrow();
 expect(()=>reviewToolOutcome({tool:"test",expected:"x",actual:"y",status:"invalid" as "ok"})).toThrow();
});
