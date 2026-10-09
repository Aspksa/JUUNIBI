describe("Brain 7.0 safe knowledge suggestions", () => {
  it("groups repeated math gaps without promoting or inventing factual links", async () => {
    const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-links-"));
    try {
      const ledger=new KnowledgeLedger(path.join(dir,"knowledge.json"));
      const values=[[41,22],[29,17],[17,19],[14,16]];
      for(const [a,b] of values)ledger.addVerified({topic:"математика",claim:`${a} × ${b} = ${a*b}`,source:"Локальный арифметический тест",evidence:"deterministic-test"});
      expect(ledger.list()).toHaveLength(4);
      expect(ledger.suggestedLinks()).toHaveLength(6);
      expect(ledger.suggestedLinks().every(x=>x.verified===false&&x.relation==="same-operation")).toBe(true);
      expect(ledger.gaps()).toHaveLength(0);
      expect(ledger.graph().edges).toHaveLength(0);
      const extra=ledger.addVerified({topic:"русский язык",claim:"Подлежащее обозначает предмет речи",source:"Проверил пользователь",evidence:"owner-confirmed"});
      expect(ledger.gaps()).toEqual([expect.objectContaining({id:extra.id,topic:"русский язык",count:1})]);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it("groups unconnected entries of the same topic into one diagnostic", async () => {
    const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-grouped-"));
    try {
      const ledger=new KnowledgeLedger(path.join(dir,"knowledge.json"));
      const a=ledger.addVerified({topic:"наука",claim:"Проверенное утверждение A",source:"user",evidence:"owner-confirmed"});
      const b=ledger.addVerified({topic:"наука",claim:"Проверенное утверждение B",source:"user",evidence:"owner-confirmed"});
      ledger.review(a.id,false);
      expect(ledger.gaps()).toEqual([expect.objectContaining({id:a.id,priority:2,count:1}),expect.objectContaining({id:b.id,priority:1,count:1})]);
      expect(ledger.suggestedLinks()).toHaveLength(0);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { KnowledgeLedger } from "./knowledge-ledger";

describe("Brain 4.0 knowledge ledger", () => {
  it("links only verified entries with shared meaningful terms", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-graph-"));
    try {
      const ledger = new KnowledgeLedger(path.join(dir, "g.json"));
      const a = ledger.addVerified({ topic: "physics", claim: "gravity attracts planetary bodies", source: "test", evidence: "owner-confirmed" });
      const b = ledger.addVerified({ topic: "physics", claim: "gravity governs many planetary orbits", source: "test", evidence: "owner-confirmed" });
      const c = ledger.addVerified({ topic: "botany", claim: "leaves photosynthesize light", source: "test", evidence: "owner-confirmed" });
      expect(ledger.graph().edges).toEqual([{ from: a.id, to: b.id, shared: expect.arrayContaining(["physics", "gravity", "planetary"]) }]);
      ledger.review(b.id, false);
      expect(ledger.graph().edges).toHaveLength(0);
      expect(ledger.graph().nodes.some(n => n.id === c.id)).toBe(true);
      expect(ledger.gaps().find(g => g.id === b.id)?.priority).toBe(2);
      expect(ledger.gaps().some(g => g.id === c.id)).toBe(true);
      await ledger.flush();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("requires trusted provenance and rejects arbitrary promotion", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-ledger-"));
    try {
      const ledger = new KnowledgeLedger(path.join(dir, "k.json"));
      expect(() => ledger.addVerified({ topic: "math", claim: "2+2=4", source: "LLM", evidence: "model" as never })).toThrow();
      const item = ledger.addVerified({ topic: "math", claim: "2+2=4", source: "independent arithmetic", evidence: "deterministic-test" });
      expect(ledger.list()).toHaveLength(1);
      expect(ledger.addVerified({ topic: "math", claim: "2+2=4", source: "test", evidence: "owner-confirmed" }).id).toBe(item.id);
      await ledger.flush();
      const restored = new KnowledgeLedger(path.join(dir, "k.json"));
      await restored.load();
      expect(restored.list()).toHaveLength(1);
      expect(restored.due(new Date(Date.now() + 3 * 86400000))).toHaveLength(1);
      expect(restored.review(item.id, false).status).toBe("needs-review");
      await restored.flush();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
