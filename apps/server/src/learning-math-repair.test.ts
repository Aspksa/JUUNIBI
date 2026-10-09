import { afterEach, expect, it } from "vitest";
import { AutonomousLearning } from "./autonomous-learning";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
it("retries a failed arithmetic question, validates recovery and persists counters", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-learning-")); directories.push(dir);
 const file = path.join(dir, "learning.json");
 const questions:string[] = [];
 const ask = async (q:string) => {
   questions.push(q);
   if (questions.length === 3) return { text:"incorrect",tokens:10 };
   if (questions.length === 4) {
     const m=/Вычисли (\d+) × (\d+)/.exec(q)!;
     return { text:String(Number(m[1])*Number(m[2])),tokens:10 };
   }
   return { text:"unverified",tokens:10 };
 };
 const learning = new AutonomousLearning(file,ask,()=>[]);
 for(let i=0;i<3;i++)await learning.tick();
 expect(learning.status().pendingMathRetry).toBe(true);
 const original=questions[2];
 await learning.tick();
 expect(questions[3]).toBe(original);
 expect(learning.status().retryResults).toEqual({ attempted:1, corrected:1 });
 expect(learning.status().pendingMathRetry).toBe(false);
 const restored=new AutonomousLearning(file,ask,()=>[]);
 await restored.load();
 expect(restored.status().retryResults).toEqual({ attempted:1, corrected:1 });
});
it("never retries an incorrect arithmetic answer more than twice",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-learning-"));directories.push(dir);
 const questions:string[]=[];
 const l=new AutonomousLearning(path.join(dir,"x.json"),async q=>{questions.push(q);return {text:"incorrect",tokens:10};},()=>[]);
 for(let i=0;i<5;i++)await l.tick();
 expect(questions[2]).toBe(questions[3]);
 expect(questions[3]).toBe(questions[4]);
 expect(l.status().retryResults).toEqual({attempted:2,corrected:0});
 expect(l.status().pendingMathRetry).toBe(false);
});
