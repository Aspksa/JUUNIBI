import { describe, expect, it } from "vitest";
import { analyzeExperience } from "./experience-learning-report";
import type { ToolObservation } from "./tool-failure-patterns";
import type { DecisionRecord } from "./decision-memory";
const item=(tool:string,status:ToolObservation["status"],at="2026-10-09T00:00:00.000Z"):ToolObservation=>({tool,status,risk:"read",elapsedMs:20,at});
const decision=(observed:"success"|"failure",predictedSuccess:boolean,taskType="plan"):DecisionRecord=>({
 id:Math.random().toString(),at:"2026-10-09T00:00:00.000Z",goal:"goal",chosen:"safe",reason:"test",
 predictedSuccess,taskType,observed
});
describe("thirteen experience-learning signals",()=>{
 it("returns exactly thirteen signals and keeps denials distinct from technical errors",()=>{
  const a=analyzeExperience([item("search","ok"),item("search","error"),item("search","error"),item("write","denied")],[decision("success",true),decision("failure",true)]);
  expect(a.signals).toHaveLength(13);
  expect(a.signals.find(x=>x.id==="tool_errors")?.value).toBe(2);
  expect(a.signals.find(x=>x.id==="tool_denials")?.value).toBe(1);
  expect(a.signals.find(x=>x.id==="decision_prediction_accuracy")?.value).toBe(50);
  expect(a.byTool.find(x=>x.name==="search")?.recurringErrors).toBe(true);
  expect(a.advisoryOnly).toBe(true);
  expect(a.requiresOwnerConfirmation).toBe(true);
 });
 it("avoids misleading percentages without evidence",()=>{
  const a=analyzeExperience([],[]);
  expect(a.signals.find(x=>x.id==="tool_success_rate")?.value).toBeNull();
  expect(a.signals.find(x=>x.id==="decision_success_rate")?.value).toBeNull();
  expect(a.signals.find(x=>x.id==="tool_success_trend_points")?.value).toBeNull();
  expect(a.warnings).toHaveLength(2);
 });
 it("validates bounded datasets and filters malformed tool records",()=>{
  expect(()=>analyzeExperience(Array.from({length:101},()=>item("x","ok")),[])).toThrow();
  const a=analyzeExperience([{...item("x","ok"),elapsedMs:-1},item("x","ok")],[]);
  expect(a.signals.find(x=>x.id==="tool_samples")?.value).toBe(1);
 });
});
