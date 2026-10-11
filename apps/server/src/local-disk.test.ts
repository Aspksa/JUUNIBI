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
   await fresh.toggleFavorite(uploaded.id,true);
   expect(fresh.list().files[0]?.favorite).toBe(true);
   await fresh.createFolder("Работа");
   await fresh.moveFile(uploaded.id,"Работа");
   expect(fresh.list("Работа").files).toHaveLength(1);
   await expect(fresh.moveFile(uploaded.id,"missing")).rejects.toMatchObject({status:404});
   await fresh.remove(uploaded.id);
   expect(fresh.list().files).toHaveLength(0);
   expect(fresh.list().trash).toHaveLength(1);
   await expect(fresh.download(uploaded.id)).rejects.toMatchObject({status:404});
   const afterDelete=new LocalDisk(dir);await afterDelete.load();
   expect(afterDelete.list().trash).toHaveLength(1);
   await afterDelete.restore(uploaded.id);
   expect(afterDelete.list("Работа").files).toHaveLength(1);
   await afterDelete.remove(uploaded.id);
   await afterDelete.purge(uploaded.id);
   expect(afterDelete.list().trash).toHaveLength(0);
   await expect(afterDelete.restore(uploaded.id)).rejects.toMatchObject({status:404});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it("validates and persists batch operations without partial changes",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-disk-"));
  try{
   const disk=new LocalDisk(dir);
   await disk.createFolder("Работа");
   const a=await disk.upload("one.txt","",Buffer.from("1").toString("base64"));
   const b=await disk.upload("two.txt","",Buffer.from("2").toString("base64"));
   await expect(disk.bulk([a.id,b.id],"move","missing")).rejects.toMatchObject({status:404});
   expect(disk.list("").files).toHaveLength(2);
   await disk.bulk([a.id,b.id],"move","Работа");
   await disk.bulk([a.id,b.id],"favorite");
   expect(disk.list("Работа").files.every(x=>x.favorite)).toBe(true);
   await disk.bulk([a.id,b.id],"trash");
   expect(disk.list().trash).toHaveLength(2);
   await expect(disk.bulk([a.id,b.id],"favorite")).rejects.toMatchObject({status:409});
   const restored=new LocalDisk(dir);await restored.load();
   await restored.bulk([a.id,b.id],"restore");
   expect(restored.list("Работа").files).toHaveLength(2);
   await expect(restored.bulk([a.id,a.id],"trash")).rejects.toMatchObject({status:400});
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
 it("supports nested folders, raw byte uploads and verified local text search",async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-disk-nested-"));
   try{
     const disk=new LocalDisk(dir);
     await disk.createFolder("Проекты");
     await disk.createFolder("Проекты/JUUNIBI");
     await expect(disk.createFolder("Нет/Вложение")).rejects.toMatchObject({status:404});
     const uploaded=await disk.uploadBytes("readme.md","Проекты/JUUNIBI",Buffer.from("Мозг JUUNIBI использует память"));
     const binary=await disk.uploadStream("image.png","Проекты/JUUNIBI",(async function*(){yield Buffer.from([1,2]);yield Buffer.from([3,4]);})());
     expect(disk.list("Проекты/JUUNIBI").files).toHaveLength(2);
     expect(await disk.searchContent("память")).toEqual([uploaded.id]);
     expect(await disk.searchContent("несуществующий")).toEqual([]);
     expect(Buffer.from((await disk.download(binary.id)).base64,"base64")).toEqual(Buffer.from([1,2,3,4]));
     const fresh=new LocalDisk(dir);await fresh.load();
     expect(fresh.list("Проекты/JUUNIBI").files).toHaveLength(2);
   }finally{await rm(dir,{recursive:true,force:true});}
 });

 it("renames a nested folder and updates file paths without losing bytes",async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-rename-"));
   try {
     const disk=new LocalDisk(dir);
     await disk.createFolder("Проекты");
     await disk.createFolder("Проекты/Старое");
     const e=await disk.upload("note.txt","Проекты/Старое",Buffer.from("data").toString("base64"));
     await disk.renameFolder("Проекты/Старое","Проекты/Новое");
     expect(disk.list("Проекты/Новое").files[0]?.id).toBe(e.id);
     expect(Buffer.from((await disk.download(e.id)).base64,"base64").toString()).toBe("data");
     await expect(disk.renameFolder("Проекты","Проекты/Новое/Сломано")).rejects.toMatchObject({status:400});
   } finally {await rm(dir,{recursive:true,force:true});}
 });

 it("tracks exact duplicates, metadata and detects corrupt objects",async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-audit-"));
   try{
     const disk=new LocalDisk(dir);
     const a=await disk.uploadBytes("one.txt","",Buffer.from("same"));
     const b=await disk.uploadBytes("two.txt","",Buffer.from("same"));
     expect(disk.duplicates()).toHaveLength(1);
     expect(disk.duplicates()[0]?.map(x=>x.id)).toEqual([a.id,b.id]);
     await disk.setMetadata(a.id,{tags:["личное","важное"],color:"#abcdef",note:"Запись"});
     expect(disk.list().files.find(x=>x.id===a.id)?.tags).toEqual(["личное","важное"]);
     expect(disk.snapshot().folders).toEqual([]);
     expect((await disk.audit()).ok).toBe(2);
     await expect(disk.setMetadata(a.id,{color:"red"})).rejects.toMatchObject({status:400});
   }finally{await rm(dir,{recursive:true,force:true});}
 });

 it("copies, moves, styles and trashes nested folder branches",async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-tree12-"));
   try{
     const disk=new LocalDisk(dir);
     await disk.createFolder("Главная");await disk.createFolder("Главная/Внутри");
     const a=await disk.uploadBytes("hello.txt","Главная/Внутри",Buffer.from("hello"));
     const cover=await disk.uploadBytes("cover.png","Главная",Buffer.from([137,80,78,71]));
     await disk.setFolderStyle("Главная","#abcdef",true,cover.id);
     await expect(disk.setFolderStyle("Главная","#abcdef",true,"Обложка")).rejects.toMatchObject({status:400});
     expect(disk.folderDecorations()["Главная"]?.pinned).toBe(true);
     const cp=await disk.copyFolder("Главная","");
     expect(cp.files).toBe(2);
     expect(disk.list("Главная - копия/Внутри").files).toHaveLength(1);
     await disk.moveFolder("Главная - копия","Главная/Внутри");
     expect(disk.list("Главная/Внутри/Главная - копия/Внутри").files).toHaveLength(1);
     const removed=await disk.trashFolder("Главная/Внутри/Главная - копия");
     expect(removed.files).toBe(1);
     expect(disk.list().trash).toHaveLength(1);
     expect(disk.listDeletedFolders()).toHaveLength(1);
     const loaded=new LocalDisk(dir);await loaded.load();
     expect(loaded.listDeletedFolders()[0]?.root).toBe("Главная/Внутри/Главная - копия");
     const restored=await loaded.restoreFolder("Главная/Внутри/Главная - копия");
     expect(restored.files).toBe(1);
     expect(loaded.list("Главная/Внутри/Главная - копия/Внутри").files).toHaveLength(1);
     expect(Buffer.from((await disk.download(a.id)).base64,"base64").toString()).toBe("hello");
   }finally{await rm(dir,{recursive:true,force:true});}
 });

});
