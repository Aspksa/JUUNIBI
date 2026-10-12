import {describe,expect,it} from "vitest";
import {LAYER_TEXT,RAIL,RAIL_ITEMS,SEARCHABLE,activeItem,type TreeMode} from "./kitsune-sections";

const ALL:TreeMode[]=["mindmap","updates","architect","history","versions","comparison","brain-chat","discovery","growth","fox"];
describe("левая панель Лисьего древа",()=>{
 it("все режимы доступны из панели",()=>{
  const used=new Set(RAIL_ITEMS.map(i=>i.mode));
  for(const m of ALL)expect(used.has(m)).toBe(true);
 });
 it("идентификаторы уникальны, подписи и подсказки на русском и непустые",()=>{
  expect(new Set(RAIL_ITEMS.map(i=>i.id)).size).toBe(RAIL_ITEMS.length);
  for(const i of RAIL_ITEMS){expect(i.label.length).toBeGreaterThan(2);expect(i.hint.length).toBeGreaterThan(8);expect(i.label+i.hint).not.toMatch(/[A-Za-z]/);}
 });
 it("четыре группы: карта, лес, ход развития, анализ",()=>{ expect(RAIL.map(g=>g.id)).toEqual(["tree","forest","history","analysis"]); });
 it("карта-схема — единственная карта и стоит первой; у четырёх слоёв есть пояснения",()=>{
  expect(RAIL[0]!.items.map(i=>i.id)).toEqual(["mindmap"]);
  expect(Object.keys(LAYER_TEXT)).toEqual(["structure","links","stages","impact"]);
  for(const l of Object.values(LAYER_TEXT)){expect(l.title.length).toBeGreaterThan(3);expect(l.lead.length).toBeGreaterThan(20);}
 });
 it("активный пункт находится по режиму и виду леса",()=>{
  expect(activeItem("mindmap","metrics")?.id).toBe("mindmap");
  expect(activeItem("fox","awards")?.id).toBe("awards");
  expect(activeItem("fox","metrics")?.id).toBe("metrics");
  expect(activeItem("comparison","metrics")?.id).toBe("comparison");
 });
 it("поиск — только там, где он что-то делает",()=>{
  expect(SEARCHABLE.has("fox")).toBe(false);
  expect(SEARCHABLE.has("mindmap")).toBe(false);
  expect(SEARCHABLE.has("history")).toBe(true);
 });
});
