import {describe,it,expect} from "vitest";
import {forestAwards,forestStory,forestEffects,sparkPoints,mergeForestEvents,safeForestEvents} from "./kitsune-fox-life";
import {foxMetrics} from "./kitsune-fox-metrics";
describe("Fox Commotion 4 real-event systems",()=>{
 const metrics=foxMetrics({nodes:[],snapshot:null,growth:[]});
 it("awards are locked until verified sources report their conditions",()=>{
  const awards=forestAwards(metrics,{});
  expect(awards).toHaveLength(100);
  expect(awards.every(a=>!a.earned)).toBe(true);
  expect(forestStory([],metrics)).toContain("первые воспоминания");
 });
 it("deduplicates source events and bounds the journal",()=>{
  const event={id:"install-1",day:"2026-10-12",kind:"update" as const,title:"Установлено",detail:"Проверенный релиз"};
  expect(mergeForestEvents([event],[event])).toHaveLength(1);
  expect(mergeForestEvents([],Array.from({length:300},(_,i)=>({...event,id:String(i)})))).toHaveLength(150);
  expect(safeForestEvents([event,{id:"x",day:"",kind:"broken",title:"x",detail:"x"}])).toHaveLength(1);
 });
 it("never fabricates a graph without measured values",()=>{
  expect(sparkPoints([])).toBe("");
  expect(sparkPoints([{day:"2026-10-12",value:1}])).toBe("");
  expect(sparkPoints([{day:"2026-10-11",value:1},{day:"2026-10-12",value:3}])).toContain(",");
 });
 it("maps reactions to event classes",()=>{
  expect(forestEffects("recovery")).toContain("Лес");
  expect(forestEffects("warning")).toContain("неполадку");
 });
});
