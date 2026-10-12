import {describe,expect,it} from "vitest";
import {labelLines,layoutTreeArt,type ArtNode} from "./kitsune-tree-art";

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
 it("раскладка детерминирована и все узлы внутри картинки без наложения в ряду",()=>{
  const a=layoutTreeArt(sample),b=layoutTreeArt([...sample].reverse());
  expect(b.nodes.map(x=>[x.id,x.x,x.y]).sort()).toEqual(a.nodes.map(x=>[x.id,x.x,x.y]).sort());
  for(const p of a.nodes){expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x).toBeLessThanOrEqual(a.width);expect(p.y).toBeGreaterThan(0);expect(p.y).toBeLessThan(a.height);}
  for(const stage of [1,2]){
   const xs=a.nodes.filter(p=>sample.find(s=>s.id===p.id)!.stage===stage).map(p=>p.x).sort((p,q)=>p-q);
   for(let i=1;i<xs.length;i++)expect(xs[i]!-xs[i-1]!).toBeGreaterThanOrEqual(60);
  }
 });
 it("рёбра — по зависимостям, а связь с запланированным помечена пунктиром",()=>{
  const l=layoutTreeArt(sample);
  expect(l.edges.length).toBe(sample.reduce((s,x)=>s+x.dependsOn.length,0));
  expect(l.edges.filter(e=>e.planned).map(e=>e.to)).toEqual(["plan","plan"]);
  expect(l.edges.every(e=>/^M[\d. -]+C[\d. -]+$/.test(e.d))).toBe(true);
 });
 it("зависимость от несуществующей ветви не ломает рисунок",()=>{
  const l=layoutTreeArt([n("a",0),n("b",1,["ghost","a"])]);
  expect(l.edges.map(e=>e.from)).toEqual(["a"]);
 });
 it("пустой набор и один узел",()=>{
  expect(layoutTreeArt([]).nodes).toEqual([]);
  expect(layoutTreeArt([n("solo",0)]).nodes.length).toBe(1);
 });
 it("подписи в две строки с многоточием",()=>{
  expect(labelLines("Brain Evolution 2.0")).toEqual(["Brain Evolution","2.0"]);
  expect(labelLines("Core")).toEqual(["Core"]);
  expect(labelLines("Очень длинное название ветви которое не помещается целиком в подпись").length).toBe(2);
  expect(labelLines("")).toEqual([]);
 });
});
