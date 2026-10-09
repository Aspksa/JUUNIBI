import { expect, it } from 'vitest';
import { makeReasoningTask, checkReasoningAnswer } from './reasoning-assessment';
it('checks deterministic logic retries', () => { const task=makeReasoningTask('logic',2); expect(checkReasoningAnswer(task,task.expected)).toBe(true); });
import { AutonomousLearning } from './autonomous-learning';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
it('retries the exact failed logic question',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'logic-'));
 try {
  const seen:string[]=[];
  const task=makeReasoningTask('logic',2);
  const learner=new AutonomousLearning(path.join(dir,'state.json'),async question=>{
    seen.push(question);return {text:seen.length===3?task.expected:'wrong',tokens:5};
  },()=>[]);
  await learner.configure({reasoning:false});
  await learner.tick();await learner.tick();await learner.tick();
  expect(seen[1]).toBe(task.question);
  expect(seen[2]).toBe(task.question);
  expect(learner.status().logicRetryResults.corrected).toBe(1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
