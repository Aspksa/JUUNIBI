import {describe,it,expect} from "vitest";
import {evolutionFromUpdater} from "./kitsune-updates";
import type {UpdateStatus,UpdateHistory} from "../api";
const status=(phase:UpdateStatus["phase"],localVersion="old"):UpdateStatus=>({
 phase,localVersion,percent:0,downloadedFiles:0,totalFiles:0,downloadedBytes:0,totalBytes:0,
 message:"",latest:{sha:"new",version:"new",description:"Brain memory upgrade",date:"2026-10-12"}
});
const history:UpdateHistory={rollbackPending:false,canRollback:null,items:[
 {id:"1",at:"2026-10-12",kind:"install",from:"old",to:"new",message:"Brain update"}
]};
describe("Kitsune update integration",()=>{
 it("labels downloaded release verified but not installed",()=>{
  expect(evolutionFromUpdater(status("ready"),null)[0]?.state).toBe("verified");
  expect(evolutionFromUpdater(status("downloading"),null)[0]?.state).toBe("downloading");
  expect(evolutionFromUpdater(status("idle"),null)[0]?.state).toBe("available");
 });
 it("marks installed only when updater history and active version agree",()=>{
  expect(evolutionFromUpdater(status("idle","new"),history)[0]?.state).toBe("installed");
  expect(evolutionFromUpdater(status("idle","old"),history).find(x=>x.id==="history:1")?.state).toBe("rolled-back");
 });
 it("links release topics without pretending path heuristics are verified",()=>{
  expect(evolutionFromUpdater(status("idle"),null)[0]?.relatedBranches).toContain("brain");
  expect(evolutionFromUpdater(null,null)).toEqual([]);
 });
 it("показывает неудачные установки и возврат после сбоя запуска, но не считает их установленными",()=>{
  const h:UpdateHistory={rollbackPending:false,canRollback:null,items:[
   {id:"f1",at:"2026-10-12",kind:"failed",from:"old",to:"bad",message:"хеш не совпал"},
   {id:"f2",at:"2026-10-12",kind:"startup_failed",from:"old",to:"worse"}]};
  const list=evolutionFromUpdater(status("idle","old"),h);
  expect(list.filter(x=>x.id.startsWith("history:")).map(x=>x.state)).toEqual(["failed","failed"]);
  expect(list.find(x=>x.id==="history:f1")?.description).toBe("хеш не совпал");
  expect(list.find(x=>x.id==="history:f2")?.title).toBe("Версия не запустилась");
 });
});
