import {describe,expect,it} from "vitest";
import {canTravel,frameDiff,timeFrames} from "./kitsune-time";
import {dateRu,ruTitle,shortVersion,statusRu,withRuTitle} from "./kitsune-ru";
import type {EvolutionNode,EvolutionSnapshot} from "./kitsune-evolution-model";

const node=(id:string,o:Partial<EvolutionNode>={}):EvolutionNode=>({id,title:id,description:"",how:"",status:"implemented",dependsOn:[],stage:0,...o});
const A="a".repeat(40),B="b".repeat(40),C="c".repeat(40);
const snap=(version:string,ids:string[],recordedAt?:string)=>({version,digest:version,manifest:{schemaVersion:1,project:"JUUNIBI",nodes:ids.map(i=>node(i))},...(recordedAt?{recordedAt}:{})});
const timeline=(snapshots:ReturnType<typeof snap>[],activeVersion:string,history:EvolutionSnapshot["timeline"]["history"]=[]):EvolutionSnapshot["timeline"]=>({history,activeVersion,durable:true,snapshots});

describe("ползунок времени",()=>{
 it("без снимков остаётся один кадр «Сейчас» и путешествовать нельзя",()=>{
  const f=timeFrames(timeline([],"dev"),[node("core")]);
  expect(f.map(x=>x.label)).toEqual(["Сейчас"]);
  expect(canTravel(f)).toBe(false);
  expect(timeFrames(null,[node("core")]).length).toBe(1);
 });
 it("кадры идут от старого к новому, а последний — текущая карта",()=>{
  const f=timeFrames(timeline([snap(B,["core","brain"],"2026-10-12 08:00:00"),snap(A,["core"],"2026-10-10 08:00:00")],B),[node("core"),node("brain"),node("disk")]);
  expect(f.map(x=>x.key)).toEqual(["v:"+A,"v:"+B]);
  expect(f[1]!.label).toBe("Сейчас");
  expect(f[1]!.nodes.map(n=>n.id)).toEqual(["core","brain","disk"]); // текущая карта, а не старый снимок
  expect(f[0]!.nodes.map(n=>n.id)).toEqual(["core"]);
  expect(canTravel(f)).toBe(true);
 });
 it("если активной версии нет среди снимков, «Сейчас» добавляется в конец",()=>{
  const f=timeFrames(timeline([snap(A,["core"],"2026-10-10 08:00:00")],C),[node("core"),node("x")]);
  expect(f.map(x=>x.key)).toEqual(["v:"+A,"current"]);
  expect(f[1]!.detail).toContain(shortVersion(C));
 });
 it("дата берётся из журнала установок, иначе из времени записи снимка",()=>{
  const h=[{id:"1",at:"2026-10-09T10:00:00Z",kind:"install",from:"",to:A,message:""}];
  const f=timeFrames(timeline([snap(A,["core"],"2026-10-11 08:00:00")],B,h),[node("core")]);
  expect(f[0]!.label).toBe(dateRu("2026-10-09T10:00:00Z"));
  const g=timeFrames(timeline([snap(A,["core"],"2026-10-11T08:00:00Z")],B),[node("core")]);
  expect(g[0]!.label).toBe(dateRu("2026-10-11T08:00:00Z"));
 });
 it("различия между кадрами по идентификаторам ветвей",()=>{
  const f=timeFrames(timeline([snap(A,["core","old"],"2026-10-10T08:00:00Z")],B),[node("core"),node("fresh")]);
  expect(frameDiff(f[0]!,f[1]!)).toEqual({added:["fresh"],removed:["old"]});
 });
});
describe("русские названия",()=>{
 it("известные ветви переводятся, неизвестные остаются как есть",()=>{
  expect(ruTitle("brain","Brain Evolution 2.0")).toBe("Мозг 2.0");
  expect(ruTitle("memory","Graph Memory")).toBe("Графовая память");
  expect(ruTitle("mystery","Своё имя")).toBe("Своё имя");
  expect(withRuTitle({id:"agent",title:"Agent",extra:1}).title).toBe("Агент");
 });
 it("в русских названиях нет латиницы (кроме цифр и имени JUUNIBI)",()=>{
  for(const id of ["core","brain","memory","search","strategy","benchmark","tasks","disk","agent","kitsune","evolution3"])
   expect(ruTitle(id,"X").replace(/JUUNIBI/g,"")).not.toMatch(/[A-Za-z]/);
 });
 it("статусы и версии",()=>{
  expect(statusRu("implemented")).toBe("Подтверждено");
  expect(statusRu("planned")).toBe("Запланировано");
  expect(shortVersion(A)).toBe("aaaaaaa");
  expect(shortVersion("dev-build-123456789")).toBe("dev-build-12");
  expect(dateRu("не дата")).toBe("");
 });
});
