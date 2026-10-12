import {describe,it,expect} from "vitest";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {KnowledgeVectorCache} from "./knowledge-vector-cache";
describe("persistent knowledge vectors",()=>{
 it("reuses vectors after restart without exposing source text on disk",async()=>{
   const dir=await mkdtemp(path.join(tmpdir(),"juunibi-vector-"));
   try {
     const file=path.join(dir,"cache.json");let calls=0;
     const provider={id:"mock-v1",embed:async(_:string)=>{calls++;return [0.5,1];}};
     const first=new KnowledgeVectorCache(file);
     expect(await first.embed(provider,"секретная проверочная фраза")).toEqual([0.5,1]);
     await first.flush();
     const disk=await readFile(file,"utf8");
     expect(disk).not.toContain("секретная проверочная фраза");
     const second=new KnowledgeVectorCache(file);
     expect(await second.embed(provider,"секретная проверочная фраза")).toEqual([0.5,1]);
     expect(calls).toBe(1);
     await second.embed({...provider,id:"mock-v2"},"секретная проверочная фраза");
     expect(calls).toBe(2);
     await second.flush();
   } finally {await rm(dir,{recursive:true,force:true});}
 });
 it("rejects invalid provider vectors",async()=>{
   const dir=await mkdtemp(path.join(tmpdir(),"juunibi-vector-bad-"));
   try {await expect(new KnowledgeVectorCache(path.join(dir,"cache.json")).embed({id:"bad",embed:async()=>[NaN]},"text")).rejects.toThrow();}
   finally {await rm(dir,{recursive:true,force:true});}
 });
});
