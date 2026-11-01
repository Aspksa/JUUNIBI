import { describe, expect, it } from "vitest";
import { evaluateBrainV7 } from "./brain-v7-engine";
import { evaluateBrainV6 } from "./brain-v6-engine";
describe("Brain 7.0 six tracks",()=>{
 it("reports sixty unique checks with truthful unknown states",()=>{
  const r=evaluateBrainV7({message:"Проверь проект"});
  expect(r.groups.map(g=>g.stages.length)).toEqual([10,10,10,10,10,10]);
  expect(r.stageCount).toBe(60);
  expect(new Set(r.groups.flatMap(g=>g.stages.map(s=>s.id))).size).toBe(60);
  expect(r.unknown).toBeGreaterThan(0);
  expect(r.actionsExecuted).toBe(false);
 });
 it("repairs checkable integer arithmetic without writing",()=>{
  const r=evaluateBrainV7({message:"12 + 7 = 20"});
  expect(r.repair).toMatchObject({verifiable:true,correct:false,proposedCorrection:"19"});
  expect(r.groups[1]?.stages.find(s=>s.id==="repair.correction_verified")?.state).toBe("verified");
 });
 it("never claims answer accuracy without independent evidence",()=>{
  const r=evaluateBrainV7({message:"Удали файлы",verifiedKnowledge:[{topic:"данные",claim:"устаревшее",status:"needs-review"}]});
  expect(r.groups[5]?.stages.find(s=>s.id==="quality.answer_accuracy")?.state).toBe("unknown");
  expect(r.requiresApproval).toBe(true);
 });
 it("reuses precomputed V6 without changing the V7 result",()=>{
  const input={message:"12 + 7 = 20"};
  const baseline=evaluateBrainV7(input);
  const shared=evaluateBrainV6(input);
  expect(evaluateBrainV7(input,shared)).toEqual(baseline);
  if (!shared.arithmetic.verifiable) throw new Error("Expected a verifiable equation");
  expect(evaluateBrainV7(input, { ...shared, arithmetic: { ...shared.arithmetic, expected: 999 } }).repair).toMatchObject({ expected: 999 });
 });
});
