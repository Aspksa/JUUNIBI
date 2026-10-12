import { describe, expect, it } from "vitest";
import { buildAtlas, type AtlasInput } from "./kitsune-atlas-model";
import { countBelow, defaultExpanded, expandToDepth, layoutMind, maxDepth, pathTo, revealHits, ROW_H, shortLabel } from "./kitsune-mindmap-model";

const input:AtlasInput={
 nodes:[
  {id:"core",title:"Ядро",status:"implemented",dependsOn:[]},
  {id:"brain",title:"Мозг 2.0",status:"implemented",dependsOn:["core"]},
  {id:"memory",title:"Графовая память",status:"implemented",dependsOn:["brain"]},
  {id:"tasks",title:"Дела",status:"planned",dependsOn:["core"]},
 ],
 metrics:[{id:"a",name:"Скорость",world:0,emoji:"⚡",value:1},{id:"b",name:"Память",world:0,emoji:"🧠",value:null}],
 worlds:[{emoji:"🌍",title:"Мир один"}],
 medals:[{id:"m1",title:"Первая",emoji:"🏅",group:"Особые",earned:true,progress:1}],
};
const tree=buildAtlas(input);

describe("карта-схема", () => {
 it("по умолчанию видны корень и первый уровень, остальное свёрнуто", () => {
  const l=layoutMind(tree,defaultExpanded(tree));
  expect(l.boxes.length).toBe(1+tree.children.length);
  expect(l.byId.get(tree.id)!.x).toBe(0);
  const hiddenBranch=l.boxes.find(b=>b.node.id==="c:forest")!;
  expect(hiddenBranch.hidden).toBeGreaterThan(0);
 });
 it("корень стоит по центру своих детей, у детей одна колонка и общий левый край", () => {
  const l=layoutMind(tree,defaultExpanded(tree));
  const kids=l.boxes.filter(b=>b.depth===1);
  const mid=(Math.min(...kids.map(k=>k.y))+Math.max(...kids.map(k=>k.y)))/2;
  expect(l.byId.get(tree.id)!.y).toBeCloseTo(mid,5);
  expect(new Set(kids.map(k=>k.x)).size).toBe(1);
 });
 it("узлы одной колонки не налезают друг на друга по вертикали", () => {
  const l=layoutMind(tree,expandToDepth(tree,9));
  const cols=new Map<number,number[]>();
  for(const b of l.boxes)(cols.get(b.depth)??cols.set(b.depth,[]).get(b.depth)!).push(b.y);
  for(const ys of cols.values()){ys.sort((a,b)=>a-b);for(let i=1;i<ys.length;i++)expect(ys[i]!-ys[i-1]!).toBeGreaterThanOrEqual(ROW_H-1e-6);}
 });
 it("раскрытие добавляет узлы, свёртка убирает; у каждой связи есть оба конца", () => {
  const closed=layoutMind(tree,defaultExpanded(tree));
  const open=layoutMind(tree,expandToDepth(tree,9));
  expect(open.boxes.length).toBeGreaterThan(closed.boxes.length);
  for(const k of open.links){expect(open.byId.has(k.from)).toBe(true);expect(open.byId.has(k.to)).toBe(true);}
  expect(open.boxes.length).toBe(1+countBelow(tree));
 });
 it("колонки идут слева направо без наложения", () => {
  const l=layoutMind(tree,expandToDepth(tree,9));
  for(const k of l.links){const a=l.byId.get(k.from)!,b=l.byId.get(k.to)!;expect(b.x).toBeGreaterThan(a.x+a.w);}
 });
 it("путь до узла и раскрытие предков найденного", () => {
  const leaf=pathTo(tree,"x:a");
  expect(leaf[0]!.id).toBe(tree.id);
  expect(leaf[leaf.length-1]!.id).toBe("x:a");
  expect(pathTo(tree,"нет такого")).toEqual([]);
  const rev=revealHits(tree,new Set(["x:a"]),defaultExpanded(tree));
  const l=layoutMind(tree,rev);
  expect(l.byId.has("x:a")).toBe(true);
 });
 it("глубина и обрезка подписей", () => {
  expect(maxDepth(tree)).toBeGreaterThanOrEqual(3);
  expect(shortLabel("а".repeat(50)).length).toBe(30);
  expect(shortLabel("коротко")).toBe("коротко");
 });
 it("границы охватывают все узлы с запасом", () => {
  const l=layoutMind(tree,expandToDepth(tree,9));
  for(const b of l.boxes){expect(b.x).toBeGreaterThan(l.bounds.x);expect(b.x+b.w).toBeLessThan(l.bounds.x+l.bounds.w);expect(b.y).toBeGreaterThan(l.bounds.y);expect(b.y).toBeLessThan(l.bounds.y+l.bounds.h);}
 });
});
