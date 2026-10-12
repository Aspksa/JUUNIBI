import {describe,expect,it} from "vitest";
import {foxMetrics} from "./kitsune-fox-metrics";
import {TREE_NODES} from "./kitsune-tree";
import {RING_LENGTH,TIER_STEPS,difficultyScore,filterMedals,medalItems,medalState,newShelfState,nextMedal,ringDash,tierOf,type MedalItem} from "./kitsune-medals";

const metrics=foxMetrics({nodes:TREE_NODES,snapshot:null,growth:[]});
const item=(o:Partial<MedalItem>):MedalItem=>({difficulty:1,id:"x",emoji:"🦊",title:"t",kind:"keeper",tier:"bronze",world:"w",earned:false,progress:0,ready:false,requirement:"r",...o});

describe("полка наград",()=>{
 it("собирает все награды в одну полку: 100 хранителей и особых и 100 легендарных",()=>{
  const items=medalItems(metrics,{});
  expect(items.length).toBe(200);
  expect(items.filter(m=>m.kind==="featured").length).toBe(10);
  expect(items.filter(m=>m.kind==="keeper").length).toBe(90);
  expect(items.filter(m=>m.kind==="legendary").length).toBe(100);
  expect(new Set(items.map(m=>m.id)).size).toBe(200);
 });
 it("сложность считается по порогам: log2(1 + порог) на условие и 0,5 за день измерений",()=>{
  expect(difficultyScore([1])).toBe(1);
  expect(difficultyScore([20])).toBe(4.39);
  expect(difficultyScore([6,3],4)).toBe(Math.round((Math.log2(7)+2+2)*100)/100);
  expect(difficultyScore([-5,Number.NaN])).toBe(0);
  expect(difficultyScore([2],-3)).toBe(difficultyScore([2]));
 });
 it("ступень по границам 3, 6 и 9",()=>{
  expect([0,2.99,3,5.99,6,8.99,9,30].map(tierOf)).toEqual(["bronze","bronze","silver","silver","gold","gold","legend","legend"]);
  expect(TIER_STEPS).toEqual([3,6,9]);
 });
 it("у каждой награды ступень определяется её сложностью, а не видом",()=>{
  const items=medalItems(metrics,{});
  for(const m of items)expect(m.tier).toBe(tierOf(m.difficulty));
  expect(items.filter(m=>m.kind==="keeper").every(m=>m.tier==="bronze")).toBe(true); // порог 1 — просто подтвердить значение
  const featured=items.filter(m=>m.kind==="featured");
  expect(new Set(featured.map(m=>m.tier)).size).toBeGreaterThan(1); // «Первый росток» (порог 1) легче «Паутинки» (20 связей)
  const legendary=items.filter(m=>m.kind==="legendary");
  const theme=legendary.filter(m=>m.id.startsWith("elite-3-"));
  expect(theme.map(m=>m.difficulty)).toEqual([...theme.map(m=>m.difficulty)].sort((a,b)=>a-b)); // внутри темы сложность растёт с рангом
  expect(new Set(legendary.map(m=>m.tier)).size).toBeGreaterThanOrEqual(3);
 });
 it("без данных награда закрыта, а не выдана и не показывает выдуманный прогресс",()=>{
  const items=medalItems(metrics,{});
  const legendary=items.filter(m=>m.kind==="legendary");
  expect(legendary.every(m=>!m.earned)).toBe(true);
  expect(legendary.every(m=>medalState(m)==="locked"||medalState(m)==="waiting"||medalState(m)==="progress")).toBe(true);
  expect(items.filter(m=>m.earned).every(m=>m.progress===1)).toBe(true);
 });
 it("кольцо прогресса ограничено 0–100% и устойчиво к мусору",()=>{
  expect(ringDash(0)).toBe("0.0 "+RING_LENGTH.toFixed(1));
  expect(ringDash(1)).toBe(RING_LENGTH.toFixed(1)+" "+RING_LENGTH.toFixed(1));
  expect(ringDash(2)).toBe(ringDash(1));
  expect(ringDash(-1)).toBe(ringDash(0));
  expect(ringDash(Number.NaN)).toBe(ringDash(0));
 });
 it("состояния: получена, в процессе, ждёт, закрыта",()=>{
  expect(medalState(item({earned:true,progress:1}))).toBe("earned");
  expect(medalState(item({progress:.4,ready:true}))).toBe("progress");
  expect(medalState(item({ready:true}))).toBe("waiting");
  expect(medalState(item({}))).toBe("locked");
 });
 it("ближайшая награда — с наибольшим прогрессом среди неполученных",()=>{
  expect(nextMedal([item({id:"a",progress:.2}),item({id:"b",progress:.7}),item({id:"c",progress:1,earned:true})])?.id).toBe("b");
  expect(nextMedal([item({}),item({earned:true,progress:1})])).toBeNull();
 });
 it("фильтры полки по состоянию и виду",()=>{
  const list=[item({id:"1",earned:true,progress:1}),item({id:"2",progress:.5,ready:true,kind:"legendary"}),item({id:"3"})];
  const s=newShelfState();
  expect(filterMedals(list,s).length).toBe(3);
  expect(filterMedals(list,{...s,view:"earned"}).map(m=>m.id)).toEqual(["1"]);
  expect(filterMedals(list,{...s,view:"progress"}).map(m=>m.id)).toEqual(["2"]);
  expect(filterMedals(list,{...s,view:"locked"}).map(m=>m.id)).toEqual(["3"]);
  expect(filterMedals(list,{...s,kind:"legendary"}).map(m=>m.id)).toEqual(["2"]);
 });
});
