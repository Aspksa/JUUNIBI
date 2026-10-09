import { describe, expect, it } from "vitest";
import { evaluateBrainV5 } from "./brain-v5-evaluation";
describe("Brain 5.0 diagnostic signals",()=>{
 it("produces thirty bounded non-executing signals",()=>{
   const r=evaluateBrainV5({message:"Сначала проверь, затем удали файл"});
   expect(r.signalCount).toBe(30);
   expect(new Set(r.signals.map(x=>x.id)).size).toBe(30);
   expect(r.actionsExecuted).toBe(false);
   expect(r.weightsUpdated).toBe(false);
   expect(r.recommendations.join(" ")).toContain("ApprovalGate");
 });
 it("does not use unverified facts",()=>{
   const r=evaluateBrainV5({message:"арифметика",verifiedKnowledge:[{topic:"арифметика",claim:"ложное утверждение",status:"needs-review"}]});
   expect(r.matchedKnowledge).toEqual([]);
   expect(r.signals.find(x=>x.id==="answer_correctness")?.state).toBe("unknown");
 });
 it("requires sufficient decision sample",()=>{
   const r=evaluateBrainV5({message:"Привет",decisionGroups:[{name:"logic",confirmed:2,successRate:0}]});
   expect(r.signals.find(x=>x.id==="confirmed_categories")?.value).toBe(0);
 });
});
