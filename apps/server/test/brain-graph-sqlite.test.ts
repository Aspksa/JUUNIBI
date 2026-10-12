import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrainGraphSQLite } from "../src/brain-graph-sqlite";
import { evaluateBrainPlanBenchmarks } from "../src/brain-plan-benchmarks";
import type { DecisionRecord } from "../src/decision-memory";

const script=fileURLToPath(new URL("../../../scripts/brain-graph-sqlite.py",import.meta.url));
const record=(id:string,goal:string,chosen:string,observed?:"success"|"failure"):DecisionRecord=>({
  id,goal,chosen,reason:"confirmed by owner",predictedSuccess:true,at:"2026-10-01",
  ...(observed?{observed,observedAt:"2026-10-02"}:{})
});
describe("durable graph and benchmarks",()=>{
  it("stores only confirmed decisions with idempotent edges across instances",async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-graph-"));
    try {
      const db=path.join(dir,"graph.sqlite3");
      const first=new BrainGraphSQLite(db,script);
      const records=[record("1","check archive","inspect files","success"),record("2","check archive","erase files","failure"),record("3","secret pending","pending")];
      await first.sync(records);
      expect(await first.stats()).toEqual({decisions:2,edges:6});
      await first.sync(records);
      expect(await first.stats()).toEqual({decisions:2,edges:6});
      const second=new BrainGraphSQLite(db,script);
      const results=await second.search("check archive",10);
      expect(results.searchMode).toBe("lexical");
      expect(results.items).toHaveLength(2);
      expect(results.items.every((item:{observed:string})=>item.observed==="success"||item.observed==="failure")).toBe(true);
      expect((await second.search("secret",5)).items).toHaveLength(0);
      await expect(second.search(" ",5)).rejects.toThrow("Некорректный");
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it("ranks with embeddings when provided and safely falls back when unavailable",async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-graph-"));
    try {
      const graph=new BrainGraphSQLite(path.join(dir,"db.sqlite3"),script);
      await graph.sync([record("1","archive","inspect files","success"),record("2","archive","erase files","failure")]);
      graph.setEmbeddingProvider({id:"fake-test",embed:async text=>text.includes("inspect")||text==="safe approach"?[1,0]:[0,1]});
      const result=await graph.search("safe approach",2);
      expect(result.searchMode).toBe("semantic");
      expect(result.items[0].chosen).toBe("inspect files");
      graph.setEmbeddingProvider({id:"broken",embed:async()=>{throw new Error("offline");}});
      expect((await graph.search("archive",2)).searchMode).toBe("lexical-fallback");
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it("reports all fixed plan quality checks",()=>{
    const result=evaluateBrainPlanBenchmarks();
    expect(result.total).toBeGreaterThanOrEqual(5);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(result.total);
    expect(result.method).toBe("deterministic-fixture-regression");
  });
});
