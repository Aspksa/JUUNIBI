import {describe,it,expect} from "vitest";
import {growthEvents} from "./kitsune-growth";
import type {EvolutionSnapshot,EvolutionNode} from "./kitsune-evolution-model";
const n=(id:string):EvolutionNode=>({id,title:id,description:"",how:"",status:"implemented",stage:0,dependsOn:[]});
const snapshot=(kind:string,original:EvolutionNode[],current:EvolutionNode[]):EvolutionSnapshot=>({manifest:{schemaVersion:1,project:"JUUNIBI",nodes:current},phase:"idle",latest:null,timeline:{activeVersion:"b",durable:true,history:[{id:"ok",kind,at:"2026-10-12",from:"a",to:"b",message:""}],snapshots:[{version:"a",digest:"a",manifest:{schemaVersion:1,project:"JUUNIBI",nodes:original}},{version:"b",digest:"b",manifest:{schemaVersion:1,project:"JUUNIBI",nodes:current}}]}});
describe("Kitsune cinematic events",()=>{
 it("branch bloom requires an actual new branch",()=>expect(growthEvents(snapshot("install",[n("root")],[n("root"),n("leaf")])).some(x=>x.kind==="new"&&x.nodeId==="leaf")).toBe(true));
 it("rollback is explicitly distinguished",()=>expect(growthEvents(snapshot("rollback",[n("root")],[n("root")]))[0]?.kind).toBe("rollback"));
 it("cannot infer growth from an install record alone",()=>{
  const s=snapshot("install",[n("root")],[n("root")]);s.timeline.snapshots=[];
  expect(growthEvents(s).map(x=>x.kind)).toEqual(["installed"]);
 });
});
