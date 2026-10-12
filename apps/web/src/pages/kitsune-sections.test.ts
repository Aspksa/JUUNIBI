import {describe,expect,it} from "vitest";
import {FOX_VIEWS,SECTIONS,SEARCHABLE,ZOOMABLE,sectionOf,treeSummary,type TreeMode} from "./kitsune-sections";

const ALL:TreeMode[]=["map","architecture","development","connections","updates","architect","history","versions","impact","comparison","brain-chat","discovery","growth","fox"];
describe("разделы Лисьего древа",()=>{
 it("каждый режим есть ровно в одном разделе",()=>{
  const listed=SECTIONS.flatMap(s=>s.modes.map(([m])=>m));
  expect([...listed].sort()).toEqual([...ALL].sort());
  expect(new Set(listed).size).toBe(listed.length);
 });
 it("четыре раздела вместо тринадцати вкладок",()=>{
  expect(SECTIONS.map(s=>s.label)).toEqual(["Карта","История","Анализ","Лисичка"]);
  expect(Math.max(...SECTIONS.map(s=>s.modes.length))).toBeLessThanOrEqual(5);
 });
 it("раздел находится по режиму",()=>{
  expect(sectionOf("map").id).toBe("map");
  expect(sectionOf("comparison").id).toBe("history");
  expect(sectionOf("impact").id).toBe("analysis");
  expect(sectionOf("fox").id).toBe("fox");
 });
 it("масштаб — только у графа и этапов, поиск — только там, где он что-то фильтрует",()=>{
  expect([...ZOOMABLE].sort()).toEqual(["architecture","connections","development"]);
  for(const m of ZOOMABLE)expect(SEARCHABLE.has(m)).toBe(true);
  expect(SEARCHABLE.has("fox")).toBe(false);
  expect(SEARCHABLE.has("map")).toBe(false);
 });
 it("у лисички четыре вида",()=>{ expect(FOX_VIEWS.map(([v])=>v)).toEqual(["today","metrics","awards","branches"]); });
 it("сводка считает подтверждённое, план, связи и события",()=>{
  expect(treeSummary([{status:"implemented",dependsOn:[]},{status:"implemented",dependsOn:["a","b"]},{status:"planned",dependsOn:["a"]}],2))
   .toEqual([{label:"подтверждено",value:2},{label:"запланировано",value:1},{label:"связей",value:3},{label:"новых событий",value:2}]);
 });
});
