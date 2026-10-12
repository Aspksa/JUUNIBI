import {describe,expect,it} from "vitest";
import {bushState,degrees,downstreamDepths,labelLines,layoutTreeArt,type ArtNode} from "./kitsune-tree-art";

const n=(id:string,stage:number,dependsOn:string[]=[],status:ArtNode["status"]="implemented"):ArtNode=>({id,title:id,stage,dependsOn,status});
const sample=[n("core",0),n("brain",1,["core"]),n("tasks",1,["core"]),n("disk",1,["core"]),n("memory",2,["brain"]),n("agent",2,["brain"]),n("plan",3,["memory","agent"],"planned")];

describe("рисунок дерева",()=>{
 it("ствол внизу, поздние этапы выше",()=>{
  const l=layoutTreeArt(sample);
  const y=(id:string)=>l.nodes.find(x=>x.id===id)!.y;
  expect(y("core")).toBeGreaterThan(y("brain"));
  expect(y("brain")).toBeGreaterThan(y("memory"));
  expect(y("memory")).toBeGreaterThan(y("plan"));
  expect(y("brain")).toBe(y("tasks"));
 });
 it("раскладка детерминирована, узлы внутри картинки, в ряду не наезжают друг на друга",()=>{
  const a=layoutTreeArt(sample),b=layoutTreeArt([...sample].reverse());
  expect(b.nodes.map(x=>[x.id,x.x,x.y]).sort()).toEqual(a.nodes.map(x=>[x.id,x.x,x.y]).sort());
  for(const p of a.nodes){expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x).toBeLessThanOrEqual(a.width);expect(p.y).toBeGreaterThan(0);expect(p.y).toBeLessThan(a.height);}
  for(const stage of [1,2]){
   const xs=a.nodes.filter(p=>sample.find(s=>s.id===p.id)!.stage===stage).map(p=>p.x).sort((p,q)=>p-q);
   for(let i=1;i<xs.length;i++)expect(xs[i]!-xs[i-1]!).toBeGreaterThanOrEqual(60);
  }
 });
 it("рёбра — по зависимостям, связь с запланированным — пунктиром",()=>{
  const l=layoutTreeArt(sample);
  expect(l.edges.length).toBe(sample.reduce((s,x)=>s+x.dependsOn.length,0));
  expect(l.edges.filter(e=>e.planned).map(e=>e.to)).toEqual(["plan","plan"]);
  expect(l.edges.every(e=>/^M[\d. -]+C[\d. -]+$/.test(e.d))).toBe(true);
 });
 it("зависимость от несуществующей ветви не ломает рисунок; пустой набор и один узел",()=>{
  expect(layoutTreeArt([n("a",0),n("b",1,["ghost","a"])]).edges.map(e=>e.from)).toEqual(["a"]);
  expect(layoutTreeArt([]).nodes).toEqual([]);
  expect(layoutTreeArt([n("solo",0)]).nodes.length).toBe(1);
 });
 it("полосы этапов: по одной на каждый этап, снизу вверх",()=>{
  const l=layoutTreeArt(sample);
  expect(l.levels.map(x=>x.stage)).toEqual([0,1,2,3]);
  expect(l.levels.map(x=>x.y)).toEqual([...l.levels.map(x=>x.y)].sort((a,b)=>b-a));
 });
});
describe("крона",()=>{
 it("без кроны картинка ниже и уже, с кроной — выше и шире",()=>{
  const plain=layoutTreeArt(sample),withCrown=layoutTreeArt(sample,10);
  expect(withCrown.height).toBeGreaterThan(plain.height);
  expect(withCrown.width).toBeGreaterThanOrEqual(plain.width);
  expect(plain.crown).toEqual([]);
 });
 it("десять кустов — куполом над ветвями, слева направо, без наложения",()=>{
  const l=layoutTreeArt(sample,10);
  expect(l.crown.length).toBe(10);
  const xs=l.crown.map(p=>p.x);
  expect(xs).toEqual([...xs].sort((a,b)=>a-b));
  for(let i=1;i<xs.length;i++)expect(xs[i]!-xs[i-1]!).toBeGreaterThanOrEqual(50);
  const top=Math.min(...l.nodes.map(p=>p.y));
  expect(Math.max(...l.crown.map(p=>p.y))).toBeLessThan(top-30);
  expect(Math.min(...l.crown.map(p=>p.y))).toBe(l.crown[4]!.y>=l.crown[5]!.y?l.crown[5]!.y:l.crown[4]!.y);
 });
 it("состояние куста по числу подтверждённых",()=>{
  expect(bushState({confirmed:0,total:10})).toBe("empty");
  expect(bushState({confirmed:5,total:10})).toBe("part");
  expect(bushState({confirmed:10,total:10})).toBe("full");
 });
});
describe("слой «Что сломается, если…»",()=>{
 it("считает шаги до каждой зависимой ветви и не включает источник",()=>{
  const d=downstreamDepths(sample,"brain");
  expect([...d.entries()].sort()).toEqual([["agent",1],["memory",1],["plan",2]]);
  expect(d.has("brain")).toBe(false);
  expect(downstreamDepths(sample,"plan").size).toBe(0);
  expect(downstreamDepths(sample,"core").size).toBe(6);
 });
 it("устойчив к циклам и неизвестным ветвям",()=>{
  expect(downstreamDepths([n("a",0,["b"]),n("b",1,["a"])],"a").size).toBe(1);
  expect(downstreamDepths(sample,"нет такой").size).toBe(0);
 });
 it("степени для слоя «Связи»: нужны (↑) и зависят (↓)",()=>{
  const d=degrees(sample);
  expect(d.get("core")).toEqual({up:0,down:3});
  expect(d.get("brain")).toEqual({up:1,down:2});
  expect(d.get("plan")).toEqual({up:2,down:0});
 });
});
describe("подписи",()=>{
 it("не больше двух строк, с многоточием",()=>{
  expect(labelLines("Лаборатория стратегий")).toEqual(["Лаборатория","стратегий"]);
  expect(labelLines("Ядро")).toEqual(["Ядро"]);
  expect(labelLines("Очень длинное название ветви которое не помещается целиком в подпись").length).toBe(2);
  expect(labelLines("")).toEqual([]);
 });
});
