import { describe, expect, it } from "vitest";
import { evaluateBrainV6 } from "./brain-v6-engine";
import { verifyIntegerEquation } from "./brain-v6-arithmetic";
describe("Brain 6.0",()=>{
 it("runs five tracks of eight checks",()=>{
  const r=evaluateBrainV6({message:"Проверь расчёт"});
  expect(r.groups.map(x=>x.checks.length)).toEqual([8,8,8,8,8]);
  expect(r.stageCount).toBe(40);
  expect(new Set(r.groups.flatMap(g=>g.checks.map(x=>x.id))).size).toBe(40);
  expect(r.actionsExecuted).toBe(false);
 });
 it("corrects bounded arithmetic",()=>{
  expect(verifyIntegerEquation("12 + 7 = 20")).toMatchObject({verifiable:true,correct:false,proposedCorrection:"19"});
  expect(verifyIntegerEquation("12 + 7 = 19")).toMatchObject({verifiable:true,correct:true});
  expect(verifyIntegerEquation("неизвестный факт")).toEqual({verifiable:false});
 });
 it("preserves risk flags and unknown assessment",()=>{
  const r=evaluateBrainV6({message:"Удали всё",verifiedKnowledge:[{topic:"данные",claim:"пример",status:"needs-review"}]});
  expect(r.requiresApproval).toBe(true);
  expect(r.groups[4]?.checks.find(x=>x.id==="answer_correctness")?.state).toBe("unknown");
  expect(r.groups[2]?.checks.find(x=>x.id==="matched")?.value).toBe(0);
 });
});
