import {describe,it,expect} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {LocalDisk} from "./local-disk";

describe("Local Disk",()=>{
 it("stores files durably, verifies bytes and isolates folder names",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-disk-"));
  try{
   const disk=new LocalDisk(dir);
   await disk.createFolder("Документы");
   const uploaded=await disk.upload("запись.txt","Документы",Buffer.from("Привет JUUNIBI").toString("base64"));
   expect(disk.list("Документы").files[0]?.name).toBe("запись.txt");
   await disk.renameFile(uploaded.id,"новое имя.txt");
   expect(disk.list("Документы").files[0]?.name).toBe("новое имя.txt");
   await expect(disk.renameFile(uploaded.id,"../secret")).rejects.toMatchObject({status:400});
   expect(Buffer.from((await disk.download(uploaded.id)).base64,"base64").toString()).toBe("Привет JUUNIBI");
   const fresh=new LocalDisk(dir);await fresh.load();
   expect(fresh.list("Документы").files).toHaveLength(1);
   expect(fresh.list("Документы").files[0]?.name).toBe("новое имя.txt");
   await expect(fresh.createFolder("../escape")).rejects.toMatchObject({status:400});
   await expect(fresh.upload("../bad","Документы","YQ==")).rejects.toMatchObject({status:400});
   await fresh.remove(uploaded.id);
   expect(fresh.list().files).toHaveLength(0);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it("limits sizes and refuses unknown folders",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-disk-"));
  try{
   const disk=new LocalDisk(dir);
   await expect(disk.upload("x.txt","missing","YQ==")).rejects.toMatchObject({status:404});
   await expect(disk.upload("x.txt","","")).rejects.toMatchObject({status:413});
   await expect(disk.upload("x.txt","","!!!")).rejects.toMatchObject({status:413});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
