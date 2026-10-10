import { describe,expect,it } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer,nextOccurrence } from "./organizer";

describe("Дела 2.1: repeat, calendar, measurements",()=>{
 it("calculates monthly dates without skipping the shorter February",()=>{
  const jan31=new Date(2027,0,31,9).getTime();
  const feb=nextOccurrence(jan31,"monthly",jan31);
  expect(new Date(feb).getMonth()).toBe(1);
  expect(new Date(feb).getDate()).toBe(28);
  const mar=nextOccurrence(feb,"monthly",feb,31);
  expect(new Date(mar).getMonth()).toBe(2);
  expect(new Date(mar).getDate()).toBe(31);
 });
 it("calculates every-three-days schedule",()=>{
  const x=new Date(2026,9,10,10).getTime();
  expect(nextOccurrence(x,"every3days",x)).toBe(new Date(2026,9,13,10).getTime());
 });
 it("keeps legacy data and produces grounded, read-only productivity statistics",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"tasks21-"));
  try{
   const current=Date.parse("2026-10-10T12:00:00Z");
   const org=new Organizer(path.join(dir,"db.json"),()=>current);
   const a=await org.addNote("todo","Важная задача");
   await org.updateTask(a.id,{priority:"high",dueAt:"2026-10-09T12:00:00Z"});
   const b=await org.addNote("todo","Выполнено");
   await org.setDone(b.id,true);
   const report=org.insights("2026-10",current);
   expect(report.statistics).toMatchObject({all:2,completed:1,open:1,overdue:1,completedThisMonth:1,completionPercent:50});
   expect(report.brainRecommendations[0]).toMatchObject({id:a.id,reason:"Просрочено",source:"local-task-metrics"});
   expect(report.advisoryOnly).toBe(true);
   expect(org.listNotes().find(n=>n.id===a.id)?.done).toBe(false);
   await expect(Promise.resolve().then(()=>org.insights("bad",current))).rejects.toMatchObject({status:400});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
