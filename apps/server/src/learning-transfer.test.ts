import { expect, it } from "vitest";
import { AutonomousLearning } from "./autonomous-learning";
import { makeReasoningTask } from "./reasoning-assessment";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

it("tests a different logic instance after correction and saves transfer metrics",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-transfer-"));
 try {
  const file=path.join(dir,"state.json");
  const initial=makeReasoningTask("logic",2);
  const fresh=makeReasoningTask("logic",19);
  const questions:string[]=[];
  const ask=async(q:string)=>{
   questions.push(q);
   const number = /числу (\d+)/.exec(q)?.[1];
   const answer = number ? (Number(number)%2===0 ? "ДА" : "НЕТ") : initial.expected;
   return {text:questions.length===2?"incorrect":answer,tokens:5};
  };
  const learner=new AutonomousLearning(file,ask,()=>[]);
  await learner.configure({reasoning:false});
  for(let i=0;i<3;i++) await learner.tick();
  expect(learner.status().pendingTransfer).toBe(1);
  expect(fresh.question).not.toBe(initial.question);
  for(let i=0;i<3;i++) await learner.tick();
  expect(questions[5]).toBe(initial.question);
  const restored=new AutonomousLearning(file,ask,()=>[]);
  await restored.load();
  await restored.tick();
  expect(questions[6]).toBe(fresh.question);
  expect(restored.status().transferMetrics).toEqual({tested:1,successful:1});
  expect(restored.status().pendingTransfer).toBe(1);
  expect(restored.status().transferSeries.completed).toBe(0);
  await restored.tick();
  await restored.tick();
  expect(restored.status().pendingTransfer).toBe(0);
  expect(restored.status().transferSeries).toEqual({completed:1,passed:1,activeCorrect:0,passRate:100});
 } finally { await rm(dir,{recursive:true,force:true}); }
});
