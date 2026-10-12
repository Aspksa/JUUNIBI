import {describe,expect,it} from "vitest";
import {eliteFoxAwards,ELITE_FOX_THEMES} from "./kitsune-fox-elite";
import {foxBranches} from "./kitsune-fox-branches";
import {foxMetrics} from "./kitsune-fox-metrics";
import type {EvolutionSnapshot} from "./kitsune-evolution-model";
describe("Fox Commotion elite achievements",()=>{
 const metrics=foxMetrics({nodes:[],snapshot:null,growth:[]});
 it("creates 100 unique authored challenges in 10 realms",()=>{
  const all=eliteFoxAwards(metrics,{});
  expect(ELITE_FOX_THEMES).toHaveLength(10);
  expect(all).toHaveLength(100);
  expect(new Set(all.map(x=>x.id)).size).toBe(100);
  expect(new Set(all.map(x=>x.name)).size).toBe(100);
 });
 it("requires two source values AND longitudinal evidence",()=>{
  const m=[...metrics];
  m[1]={...m[1]!,value:25};
  m[7]={...m[7]!,value:25};
  const challenge=eliteFoxAwards(m,{})[0]!;
  expect(challenge.earned).toBe(false);
  expect(challenge.ready).toBe(false);
  const days=["2026-10-10","2026-10-11"];
  const history={"fox-1":days.map(day=>({day,value:25})),"fox-7":days.map(day=>({day,value:25}))};
  expect(eliteFoxAwards(m,history)[0]?.earned).toBe(true);
  expect(eliteFoxAwards(m,{"fox-1":history["fox-1"]})[0]?.earned).toBe(false);
 });
});
describe("Fox branch journal",()=>{
 it("does not fabricate updates without server state",()=>{
  expect(foxBranches(null,[])).toEqual([]);
 });
 it("separates installs, failures, changes and unfinished work",()=>{
  const snapshot:EvolutionSnapshot={manifest:{schemaVersion:1,project:"JUUNIBI",nodes:[
   {id:"core",title:"Core",description:"",how:"",dependsOn:[],status:"implemented",stage:0},
   {id:"next",title:"Next",description:"",how:"",dependsOn:["core"],status:"planned",stage:1}]},
   timeline:{activeVersion:"v2",durable:true,history:[
    {id:"i",at:"2026-10-12",kind:"install",from:"v1",to:"v2",message:"done"},
    {id:"f",at:"2026-10-11",kind:"failed",from:"v1",to:"v2",message:"error"}]},
   phase:"idle",latest:null};
  const rows=foxBranches(snapshot,[{id:"change:core",kind:"changed",title:"Core",detail:"updated"}]);
  expect(rows.filter(x=>x.track==="update")).toHaveLength(1);
  expect(rows.filter(x=>x.track==="bug")).toHaveLength(1);
  expect(rows.filter(x=>x.track==="fix")).toHaveLength(1);
  expect(rows.filter(x=>x.track==="paused")).toHaveLength(1);
  expect(rows.find(x=>x.track==="paused")?.status).toBe("planned");
 });
});
