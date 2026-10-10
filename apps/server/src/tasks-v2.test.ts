import { describe, expect, it } from "vitest";
import { Organizer } from "./organizer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("Дела 2.0",()=>{
 it("preserves legacy records and persists scheduling metadata",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-tasks2-"));
  const file=path.join(dir,"organizer.json");
  try {
   await writeFile(file,JSON.stringify({notes:[{id:"old",kind:"todo",text:"Старое дело",done:false,createdAt:"2026-10-01T00:00:00.000Z"}],reminders:[]}));
   const org=new Organizer(file,()=>Date.parse("2026-10-10T09:00:00Z"));
   await org.load();
   const parent=await org.addNote("todo","Большой проект");
   const updated=await org.updateTask("old",{priority:"high",project:"JUUNIBI",dueAt:"2026-10-09T18:00:00Z",estimateMinutes:45,parentId:parent.id});
   expect(updated).toMatchObject({priority:"high",project:"JUUNIBI",estimateMinutes:45,parentId:parent.id});
   expect(org.planToday().suggested[0]?.id).toBe("old");
   const restored=new Organizer(file);
   await restored.load();
   expect(restored.listNotes().find(x=>x.id==="old")?.dueAt).toBe("2026-10-09T18:00:00.000Z");
   await restored.setDone("old",true);
   expect(restored.listNotes().find(x=>x.id==="old")?.completedAt).toBeTruthy();
  } finally {await rm(dir,{recursive:true,force:true});}
 });
 it("rejects unsafe or invalid parent chains and leaves tasks untouched",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-tasks2-"));
  try{
   const org=new Organizer(path.join(dir,"state.json"));
   const a=await org.addNote("todo","Обычное дело");
   await expect(org.updateTask(a.id,{parentId:a.id})).rejects.toMatchObject({status:400});
   await expect(org.updateTask(a.id,{estimateMinutes:-2})).rejects.toMatchObject({status:400});
   await expect(org.updateTask(a.id,{priority:"urgent"})).rejects.toMatchObject({status:400});
   expect(org.listNotes()[0]?.parentId).toBeUndefined();
  } finally {await rm(dir,{recursive:true,force:true});}
 });
});
