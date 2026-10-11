import {describe,it,expect} from "vitest";
import {mkdtemp,rm,readFile,writeFile} from "node:fs/promises";
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
     expect(removed.files).toBe(2);
     expect(disk.list().trash).toHaveLength(2);
     expect(disk.listDeletedFolders()).toHaveLength(1);
     const loaded=new LocalDisk(dir);await loaded.load();
     expect(loaded.listDeletedFolders()[0]?.root).toBe("Главная/Внутри/Главная - копия");
     const restored=await loaded.restoreFolder("Главная/Внутри/Главная - копия");
     expect(restored.files).toBe(2);
     expect(loaded.list("Главная/Внутри/Главная - копия/Внутри").files).toHaveLength(1);
     expect(Buffer.from((await disk.download(a.id)).base64,"base64").toString()).toBe("hello");
   }finally{await rm(dir,{recursive:true,force:true});}
 });

 it("copies verified bytes and persists undo across reload",async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-fileops-"));
   try{
     const disk=new LocalDisk(dir);
     await disk.createFolder("Работа");
     const a=await disk.uploadBytes("original.txt","",Buffer.from("safe-copy"));
     const b=await disk.copyFile(a.id,"Работа");
     expect(b.id).not.toBe(a.id);
     expect(Buffer.from((await disk.download(b.id)).base64,"base64").toString()).toBe("safe-copy");
     await disk.renameFile(a.id,"renamed.txt");
     await disk.moveFile(a.id,"Работа");
     const loaded=new LocalDisk(dir);await loaded.load();
     expect(loaded.fileHistory()).toHaveLength(2);
     await loaded.undoFileChange();
     expect(loaded.list("").files.some(x=>x.id===a.id&&x.name==="renamed.txt")).toBe(true);
     await loaded.undoFileChange();
     expect(loaded.list("").files.some(x=>x.id===a.id&&x.name==="original.txt")).toBe(true);
   }finally{await rm(dir,{recursive:true,force:true});}
 });

 it("stores immutable file revisions, restores old bytes and reloads history",async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-versions-"));
   try{
     const disk=new LocalDisk(dir);
     const original=await disk.uploadBytes("manual.txt","",Buffer.from("first"));
     const changed=await disk.replaceStream(original.id,(async function*(){yield Buffer.from("se");yield Buffer.from("cond");})(),original.sha256);
     expect(changed.revision).toBe(2);
     expect(disk.fileVersions(original.id).map(v=>v.revision)).toEqual([1,2]);
     expect(Buffer.from((await disk.download(original.id)).base64,"base64").toString()).toBe("second");
     await expect(disk.replaceStream(original.id,(async function*(){yield Buffer.from("wrong");})(),original.sha256)).rejects.toMatchObject({status:409});
     const reloaded=new LocalDisk(dir);await reloaded.load();
     expect(reloaded.fileVersions(original.id)).toHaveLength(2);
     const restored=await reloaded.restoreFileVersion(original.id,1);
     expect(restored.revision).toBe(3);
     expect(Buffer.from((await reloaded.download(original.id)).base64,"base64").toString()).toBe("first");
     expect(reloaded.fileVersions(original.id).map(v=>v.revision)).toEqual([1,2,3]);
     const copy=await reloaded.copyFile(original.id,"");
     expect(Buffer.from((await reloaded.download(copy.id)).base64,"base64").toString()).toBe("first");
   }finally{await rm(dir,{recursive:true,force:true});}
 });

 it("exports and restores a portable full-content backup with old versions",async()=>{
   const source=await mkdtemp(path.join(os.tmpdir(),"juunibi-export-"));
   const target=await mkdtemp(path.join(os.tmpdir(),"juunibi-import-"));
   const broken=await mkdtemp(path.join(os.tmpdir(),"juunibi-broken-"));
   try{
     const original=new LocalDisk(source);
     await original.createFolder("Проекты");
     const file=await original.uploadBytes("notes.txt","Проекты",Buffer.from("initial"));
     await original.replaceStream(file.id,(async function*(){yield Buffer.from("updated");})(),file.sha256);
     const lines:string[]=[];
     for await(const line of original.exportBackup())lines.push(line);
     const restored=new LocalDisk(target);
     const result=await restored.importBackup((async function*(){for(const line of lines)yield line.trimEnd();})());
     expect(result.files).toBe(1);
     expect(result.folders).toBe(1);
     expect(restored.fileVersions(file.id)).toHaveLength(2);
     expect(Buffer.from((await restored.download(file.id)).base64,"base64").toString()).toBe("updated");
     const old=await restored.restoreFileVersion(file.id,1);
     expect(old.revision).toBe(3);
     expect(Buffer.from((await restored.download(file.id)).base64,"base64").toString()).toBe("initial");
     await expect(restored.importBackup((async function*(){for(const line of lines)yield line.trimEnd();})())).rejects.toMatchObject({status:409});
     const altered=lines.map(line=>line.replace("dXBkYXRlZA==","dXBkYXRlYg=="));
     const bad=new LocalDisk(broken);
     await expect(bad.importBackup((async function*(){for(const line of altered)yield line.trimEnd();})())).rejects.toThrow();
     expect(bad.list().files).toHaveLength(0);
   }finally{await rm(source,{recursive:true,force:true});await rm(target,{recursive:true,force:true});await rm(broken,{recursive:true,force:true});}
 });

 it("previews local folder sync and refuses conflicting filenames without overwrite",async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-sync-"));
   try{
     const disk=new LocalDisk(dir);
     await disk.createFolder("Source");await disk.createFolder("Target");
     await disk.uploadBytes("report.txt","Source",Buffer.from("report-A"));
     const same=await disk.uploadBytes("same.txt","Source",Buffer.from("identical"));
     await disk.copyFile(same.id,"Target");
     const plan=await disk.syncFolders("Source","Target",false);
     expect(plan.pending).toBe(1);expect(plan.unchanged).toBe(1);
     expect((await disk.syncFolders("Source","Target",true)).copied).toBe(1);
     expect((await disk.syncFolders("Source","Target",false)).pending).toBe(0);
     await disk.uploadBytes("conflict.txt","Source",Buffer.from("one"));
     await disk.uploadBytes("conflict.txt","Target",Buffer.from("two"));
     const conflicts=await disk.syncFolders("Source","Target",false);
     expect(conflicts.conflicts).toHaveLength(1);
     await expect(disk.syncFolders("Source","Target",true)).rejects.toMatchObject({status:409});
     const target=disk.list("Target").files.filter(e=>e.name==="conflict.txt");
     expect(target).toHaveLength(1);
     expect(Buffer.from((await disk.download(target[0]!.id)).base64,"base64").toString()).toBe("two");
   }finally{await rm(dir,{recursive:true,force:true});}
 });

 it("opens an older index without revision metadata and upgrades safely on first change",async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-legacy-index-"));
   try{
     const original=new LocalDisk(dir);
     const e=await original.uploadBytes("legacy.txt","",Buffer.from("old"));
     const index=path.join(dir,"index.json");
     const legacy=JSON.parse(await readFile(index,"utf8")) as Record<string,unknown>;
     delete legacy.versions;delete legacy.folderStyles;delete legacy.fileActions;
     await writeFile(index,JSON.stringify(legacy));
     const loaded=new LocalDisk(dir);await loaded.load();
     expect(loaded.fileVersions(e.id).map(v=>v.revision)).toEqual([1]);
     expect((await loaded.audit()).ok).toBe(1);
     const next=await loaded.replaceStream(e.id,(async function*(){yield Buffer.from("new");})(),e.sha256);
     expect(next.revision).toBe(2);
     const again=new LocalDisk(dir);await again.load();
     expect(again.fileVersions(e.id)).toHaveLength(2);
     expect(Buffer.from((await again.download(e.id)).base64,"base64").toString()).toBe("new");
   }finally{await rm(dir,{recursive:true,force:true});}
 });

});
