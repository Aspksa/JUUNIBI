import {describe,it,expect} from "vitest";
import {growthEvents,growthTone} from "./kitsune-growth";
import type {EvolutionSnapshot,EvolutionManifest} from "./kitsune-evolution-model";
const make=(name:string):EvolutionManifest=>({schemaVersion:1,project:"JUUNIBI",nodes:[
 {id:"core",title:"Core",description:"",how:"",stage:0,status:"implemented",dependsOn:[]},
 {id:"new",title:name,description:"",how:"",stage:1,status:"implemented",dependsOn:["core"]}
]});
function snapshot(kind="install"):EvolutionSnapshot{return {
 manifest:make("New"),timeline:{activeVersion:"after",durable:true,history:[
  {id:"event1",at:"2026-10-12",kind,from:"before",to:"after",message:""}
 ],snapshots:[{version:"before",digest:"x",manifest:{...make("Old"),nodes:[make("Old").nodes[0]!]}},
 {version:"after",digest:"y",manifest:make("New")}]},phase:"idle",latest:null
};}
describe("Kitsune verified motion",()=>{
 it("animates only confirmed version-to-version changes",()=>{
  expect(growthEvents(snapshot()).map(x=>x.kind)).toEqual(["installed","new"]);
 });
 it("never labels a new feature confirmed without both snapshots",()=>{
  const s=snapshot();s.timeline.snapshots=s.timeline.snapshots?.slice(1);
  expect(growthEvents(s).map(x=>x.kind)).toEqual(["installed"]);
 });
 it("shows rollback as recovery instead of installation",()=>{
  expect(growthEvents(snapshot("rollback"))[0]?.kind).toBe("rollback");
  expect(growthTone("removed")).toBe("warning");
 });
});