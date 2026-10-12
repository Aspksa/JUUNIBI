import {describe,expect,it} from "vitest";
import {foxMetrics} from "./kitsune-fox-metrics";
import {TREE_NODES} from "./kitsune-tree";
import {RING_LENGTH,filterMedals,legendaryTier,medalItems,medalState,newShelfState,nextMedal,ringDash,type MedalItem} from "./kitsune-medals";

const metrics=foxMetrics({nodes:TREE_NODES,snapshot:null,growth:[]});
const item=(o:Partial<MedalItem>):MedalItem=>({id:"x",emoji:"🦊",title:"t",kind:"keeper",tier:"bronze",world:"w",earned:false,progress:0,ready:false,requirement:"r",...o});

describe("полка наград",()=>{
 it("собирает все награды в одну полку: 100 хранителей и особых и 100 легендарных",()=>{
  const items=medalItems(metrics,{});
  expect(items.length).toBe(200);
  expect(items.filter(m=>m.kind==="featured").length).toBe(10);
  expect(items.filter(m=>m.kind==="keeper").length).toBe(90);
  expect(items.filter(m=>m.kind==="legendary").length).toBe(100);
  expect(new Set(items.map(m=>m.id)).size).toBe(200);
 });
 it("редкость зависит от сложности, а не от случая",()=>{
  expect(legendaryTier("elite-3-0")).toBe("gold");
  expect(legendaryTier("elite-3-4")).toBe("gold");
  expect(legendaryTier("elite-3-5")).toBe("legend");
  expect(legendaryTier("elite-9-9")).toBe("legend");
  const items=medalItems(metrics,{});
  expect(items.filter(m=>m.kind==="keeper").every(m=>m.tier==="bronze")).toBe(true);
  expect(items.filter(m=>m.kind==="featured").every(m=>m.tier==="silver")).toBe(true);
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
