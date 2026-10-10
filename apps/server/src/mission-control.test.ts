import {describe,it,expect} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {Organizer} from "./organizer";

describe("Mission Control",()=>{
 it("persists missions, stages and calculates completed progress",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-mission-"));
  const file=path.join(dir,"db.json");
  try{
    const organizer=new Organizer(file);
    const mission=await organizer.addMission("Улучшить JUUNIBI","Усилить надёжность");
    const first=await organizer.addMissionStage(mission.id,"Проверить тесты");
    const second=await organizer.addMissionStage(mission.id,"Устранить ошибки");
    expect(organizer.missionBoard()[0]).toMatchObject({total:2,done:0,percent:0});
    await organizer.setDone(first.id,true);
    expect(organizer.missionBoard()[0]).toMatchObject({total:2,done:1,percent:50});
    expect(organizer.missionBoard()[0]?.next?.id).toBe(second.id);
    const loaded=new Organizer(file);
    await loaded.load();
    expect(loaded.missionBoard()[0]).toMatchObject({title:mission.title,done:1,percent:50});
    await loaded.updateMission(mission.id,"paused");
    await expect(loaded.addMissionStage(mission.id,"Без разрешения")).rejects.toMatchObject({status:409});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it("does not advance blocked stages and rejects invalid missions",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-mission-"));
  try{
   const organizer=new Organizer(path.join(dir,"db.json"));
   const mission=await organizer.addMission("Большой план");
   const parent=await organizer.addMissionStage(mission.id,"Начало");
   const child=await organizer.addMissionStage(mission.id,"Следующий этап");
   await organizer.updateTask(child.id,{parentId:parent.id});
   expect(organizer.missionBoard()[0]).toMatchObject({blocked:1,next:{id:parent.id}});
   await organizer.setDone(parent.id,true);
   expect(organizer.missionBoard()[0]).toMatchObject({blocked:0,next:{id:child.id}});
   await expect(organizer.addMission("Большой план")).rejects.toMatchObject({status:409});
   await expect(organizer.updateMission(mission.id,"invalid")).rejects.toMatchObject({status:400});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
