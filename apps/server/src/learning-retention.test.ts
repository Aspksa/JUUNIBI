import { expect, it } from "vitest";
import { AutonomousLearning } from "./autonomous-learning";
import { makeReasoningTask } from "./reasoning-assessment";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

it("checks corrected logic after a delay and persists verified retention statistics",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-retention-"));
 try{
  const file=path.join(dir,"learning.json");
  const task=makeReasoningTask("logic",2);
  const seen:string[]=[];
  const ask=async(question:string)=>{
   seen.push(question);
   return {text:question===task.question && seen.length===2?"wrong":task.expected,tokens:5};
  };
  const learning=new AutonomousLearning(file,ask,()=>[]);
  await learning.configure({reasoning:false});
  for(let i=0;i<3;i++)await learning.tick();
  expect(learning.status().pendingRetention).toBe(1);
  expect(learning.status().retentionMetrics).toEqual({tested:0,retained:0});
  await learning.tick();await learning.tick();
  expect(learning.status().retentionMetrics.tested).toBe(0);
  const restored=new AutonomousLearning(file,ask,()=>[]);
  await restored.load();
  await restored.tick();
  expect(seen[5]).toBe(task.question);
  expect(restored.status().retentionMetrics).toEqual({tested:1,retained:1});
  expect(restored.status().pendingRetention).toBe(0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
