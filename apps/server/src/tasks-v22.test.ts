import { describe,expect,it } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {Organizer} from "./organizer";
describe("Дела 2.2",()=>{
 it("snoozes due instances but never an untouched recurring series",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"tasks22-"));
  let now=Date.parse("2026-10-10T10:00:00Z");
  try{
   const org=new Organizer(path.join(dir,"state.json"),()=>now);
   const series=await org.addReminder("Тренировка","2026-10-10T10:01:00Z","daily");
   await expect(org.snoozeReminder(series.id,10)).rejects.toMatchObject({status:409});
   now+=120000;
   const fired=await org.tick();
   expect(fired).toHaveLength(1);
   const oldSeriesTime=org.listReminders().find(r=>r.id===series.id)?.at;
   const snoozed=await org.snoozeReminder(fired[0]!.id,10);
   expect(snoozed).toMatchObject({status:"scheduled",seriesId:series.id});
   expect(org.listReminders().find(r=>r.id===series.id)?.at).toBe(oldSeriesTime);
   await expect(org.snoozeReminder(snoozed.id,999)).rejects.toMatchObject({status:400});
   now+=11*60000;
   expect((await org.tick()).map(r=>r.id)).toContain(snoozed.id);
  } finally {await rm(dir,{recursive:true,force:true});}
 });
 it("schedules finite, read-only work blocks and validates dates",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"tasks22-"));
  try{
   const org=new Organizer(path.join(dir,"state.json"));
   const a=await org.addNote("todo","Важное дело");
   await org.updateTask(a.id,{priority:"high",estimateMinutes:60});
   const b=await org.addNote("todo","Обычное дело");
   await org.updateTask(b.id,{estimateMinutes:90});
   const plan=org.timeBlocks("2026-10-10");
   expect(plan).toMatchObject({plannedMinutes:150,remainingMinutes:390,advisoryOnly:true});
   expect(plan.blocks[0]?.id).toBe(a.id);
   expect(org.listNotes().every(n=>!n.done)).toBe(true);
   expect(()=>org.timeBlocks("2026-02-30")).toThrow();
   expect(()=>org.timeBlocks("2026-10-10",19,9)).toThrow();
  } finally {await rm(dir,{recursive:true,force:true});}
 });
});
