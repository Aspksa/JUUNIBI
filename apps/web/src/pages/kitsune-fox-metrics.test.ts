import {describe,expect,it} from "vitest";
import {FOX_WORLDS,foxMetrics} from "./kitsune-fox-metrics";
import type {EvolutionNode,EvolutionSnapshot} from "./kitsune-evolution-model";
const nodes:EvolutionNode[]=[
 {id:"core",title:"Core",description:"",how:"",dependsOn:[],stage:0,status:"implemented"},
 {id:"brain",title:"Brain",description:"",how:"",dependsOn:["core"],stage:1,status:"implemented"},
 {id:"future",title:"Future",description:"",how:"",dependsOn:["brain"],stage:2,status:"planned"}];
const snapshot:EvolutionSnapshot={
 manifest:{schemaVersion:1,project:"JUUNIBI",nodes},
 phase:"idle",latest:null,
 timeline:{activeVersion:"v2",durable:true,history:[{id:"1",at:"2026-10-12",kind:"install",from:"v1",to:"v2",message:"done"}],snapshots:[]},
 discovery:{scanned:8,modules:[],candidates:[{id:"x",file:"x.ts",imports:[],candidate:true}],cycles:[],unresolved:[],manifestGaps:[],truncated:false}
};
describe("Fox Commotion: 100 verifiable indicators",()=>{
 it("has 10 groups of 10 with unique ids and names",()=>{
  expect(FOX_WORLDS).toHaveLength(10);
  expect(FOX_WORLDS.every(x=>x.names.length===10)).toBe(true);
  const data=foxMetrics({nodes,snapshot,growth:[]});
  expect(data).toHaveLength(100);
  expect(new Set(data.map(x=>x.id)).size).toBe(100);
  expect(new Set(data.map(x=>x.name)).size).toBe(100);
 });
 it("does not invent values when live API is unavailable",()=>{
  const data=foxMetrics({nodes,snapshot:null,growth:[]});
  expect(data.every(m=>m.value===null)).toBe(true);
 });
 it("maps actual counts and preserves unknown status",()=>{
  const data=foxMetrics({nodes,snapshot,growth:[]});
  expect(data[0]?.value).toBe(1);
  expect(data[1]?.value).toBe(3);
  expect(data[3]?.value).toBe(1);
  expect(data[7]?.value).toBe(2);
  expect(data[35]?.value).toBe(1);
  expect(data[51]?.value).toBe(0);
  expect(data[4]?.value).toBeNull();
  expect(data[10]?.value).toBeNull();
 });
});