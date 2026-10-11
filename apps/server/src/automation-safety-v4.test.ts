import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer } from "./organizer";

describe("Умная автоматика 4.0",()=>{
  it("refuses to overwrite a manually changed deadline when undoing a move",async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-auto4-"));
    try {
      let now=Date.parse("2026-10-11T09:00:00Z");
      const file=path.join(dir,"organizer.json");
      const organizer=new Organizer(file,()=>now);
      const task=await organizer.addNote("todo","Подготовить релиз");
      await organizer.updateTask(task.id,{dueAt:"2026-10-09T12:00:00Z"});
      await organizer.moveTasks([task.id],"tomorrow");
      const log=organizer.listLog().find(x=>x.kind==="move")!;
      const ownerDate="2026-10-20T15:00:00Z";
      await organizer.updateTask(task.id,{dueAt:ownerDate});
      await expect(organizer.undoLog(log.id)).rejects.toMatchObject({status:409});
      expect(organizer.listNotes().find(x=>x.id===task.id)?.dueAt).toBe(new Date(ownerDate).toISOString());
      expect(organizer.listLog().find(x=>x.id===log.id)?.undone).toBeFalsy();
      const restored=new Organizer(file,()=>now);await restored.load();
      expect(restored.listNotes().find(x=>x.id===task.id)?.dueAt).toBe(new Date(ownerDate).toISOString());
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it("deduplicates the same move request across application restarts",async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-auto4-"));
    const file=path.join(dir,"db.json");
    try {
      const o=new Organizer(file,()=>Date.parse("2026-10-11T10:00:00Z"));
      const t=await o.addNote("todo","Написать тест");
      const key="request_12345";
      await o.moveTasks([t.id],"tomorrow",key);
      const after=o.listNotes().find(n=>n.id===t.id)?.dueAt;
      await expect(o.moveTasks([t.id],"tomorrow",key)).rejects.toMatchObject({status:409});
      const restored=new Organizer(file,()=>Date.parse("2026-10-11T10:00:00Z"));
      await restored.load();
      await expect(restored.moveTasks([t.id],"tomorrow",key)).rejects.toMatchObject({status:409});
      expect(restored.listNotes().find(n=>n.id===t.id)?.dueAt).toBe(after);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it("supports one successful undo and then rejects replay",async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-auto4-"));
    try {
      const o=new Organizer(path.join(dir,"db.json"),()=>Date.parse("2026-10-11T10:00:00Z"));
      const t=await o.addNote("todo","Репетиция");
      await o.updateTask(t.id,{dueAt:"2026-10-09T18:00:00Z"});
      await o.moveTasks([t.id],"tomorrow");
      const action=o.listLog()[0]!;
      await o.undoLog(action.id);
      expect(o.listNotes().find(n=>n.id===t.id)?.dueAt).toBe("2026-10-09T18:00:00.000Z");
      await expect(o.undoLog(action.id)).rejects.toMatchObject({status:409});
      expect(o.automationEvidence()).toMatchObject({totals:{logged:1,undone:1},advisoryOnly:true});
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
