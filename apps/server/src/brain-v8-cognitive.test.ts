import { describe,expect,it } from "vitest";
import { inspectCognition,compareCognitiveExperiment } from "./brain-v8-cognitive";
describe("Brain 8 internal cognition",()=>{
 it("uses the real learning goal to prioritize practice",()=>{
  const r=inspectCognition({message:"test",developmentGoal:{skill:"logic",baseline:40,target:55,checks:2,achieved:false}});
  expect(r.focus.kind).toBe("skill");
  expect(r.advisoryOnly).toBe(true);
  expect(r.requiresApprovalForActions).toBe(true);
 });
 it("does not treat denied tools as something to circumvent",()=>{
  const r=inspectCognition({message:"test",recentToolWarnings:[{tool:"write",caution:true,denied:3}]});
  expect(r.focus.kind).toBe("unknown");
 });
 it("only uses sufficiently sampled decisions",()=>{
  const r=inspectCognition({message:"test",decisionGroups:[{name:"coding",confirmed:7,successRate:40}]});
  expect(r.focus.kind).toBe("decisions");
 });
 it("requires paired evaluation and rejects regressions",()=>{
  const pairs=Array.from({length:10},(_,i)=>({id:String(i),controlCorrect:i<5,candidateCorrect:i<6}));
  expect(compareCognitiveExperiment(pairs).improvementSupported).toBe(true);
  expect(compareCognitiveExperiment(pairs.map(x=>({...x,candidateCorrect:x.id==="0"?false:x.candidateCorrect}))).improvementSupported).toBe(false);
  expect(()=>compareCognitiveExperiment([{id:"a",controlCorrect:true,candidateCorrect:true},{id:"a",controlCorrect:false,candidateCorrect:false}])).toThrow();
 });
});
