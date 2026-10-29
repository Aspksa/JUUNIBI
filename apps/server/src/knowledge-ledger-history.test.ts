import {describe,it,expect} from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { rm } from "../test/temp-files";
import {tmpdir} from "node:os";
import path from "node:path";
import {KnowledgeLedger} from "./knowledge-ledger";
describe("Fox Memory v5 historical provenance",()=>{
  it("persists creation and review events through a reload",async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),"juunibi-memory-history-"));
    try{
      const file=path.join(dir,"ledger.json");
      const ledger=new KnowledgeLedger(file);
      const item=ledger.addVerified({topic:"математика",claim:"3 + 4 = 7",source:"тест",evidence:"deterministic-test"});
      ledger.review(item.id,false);
      ledger.review(item.id,true);
      await ledger.flush();
      const saved=JSON.parse(await readFile(file,"utf8"));
      expect(saved[0].history.map((e:{action:string})=>e.action)).toEqual(["created","flagged","reviewed"]);
      const restored=new KnowledgeLedger(file);await restored.load();
      expect(restored.list()[0]?.history).toHaveLength(3);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it("returns independent history snapshots",async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),"juunibi-memory-copy-"));
    try{
      const ledger=new KnowledgeLedger(path.join(dir,"ledger.json"));
      ledger.addVerified({topic:"память",claim:"Контроль знаний",source:"владелец",evidence:"owner-confirmed"});
      const copy=ledger.list();copy[0]!.history![0]!.source="tampered";
      expect(ledger.list()[0]?.history?.[0]?.source).toBe("владелец");
      await ledger.flush();
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
