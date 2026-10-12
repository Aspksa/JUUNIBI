import {describe,expect,it} from "vitest";
import {LAYER_TEXT,PICTURE_MODES,RAIL,RAIL_ITEMS,SEARCHABLE,ZOOMABLE,activeItem,type TreeMode} from "./kitsune-sections";

const ALL:TreeMode[]=["map","mindmap","atlas","architecture","updates","architect","history","versions","comparison","brain-chat","discovery","growth","fox"];
describe("левая панель Лисьего древа",()=>{
 it("все режимы, кроме скрытых из панели, доступны из неё",()=>{
  const used=new Set(RAIL_ITEMS.map(i=>i.mode));
  for(const m of ALL)expect(used.has(m)).toBe(true);
  expect(used.has("connections")).toBe(false); // «Связи» — теперь слой дерева
  expect(used.has("development")).toBe(false); // «Этапы» — теперь слой дерева
  expect(used.has("impact")).toBe(false);      // «Что сломается, если…» — слой дерева
 });
 it("идентификаторы уникальны, подписи и подсказки на русском и непустые",()=>{
  expect(new Set(RAIL_ITEMS.map(i=>i.id)).size).toBe(RAIL_ITEMS.length);
  for(const i of RAIL_ITEMS){expect(i.label.length).toBeGreaterThan(2);expect(i.hint.length).toBeGreaterThan(8);expect(i.label+i.hint).not.toMatch(/[A-Za-z]/);}
 });
 it("четыре группы: дерево, лес, ход развития, анализ",()=>{ expect(RAIL.map(g=>g.id)).toEqual(["tree","forest","history","analysis"]); });
 it("слои дерева — четыре, у каждого есть пояснение",()=>{
  expect(RAIL[0]!.items.filter(i=>i.layer).map(i=>i.layer)).toEqual(["structure","links","stages","impact"]);
  expect(RAIL[0]!.items.slice(0,2).map(i=>i.id)).toEqual(["mindmap","atlas"]); // карта-схема и атлас — первыми
  for(const l of Object.values(LAYER_TEXT)){expect(l.title.length).toBeGreaterThan(3);expect(l.lead.length).toBeGreaterThan(20);}
 });
 it("активный пункт находится по режиму, слою и виду леса",()=>{
  expect(activeItem("map","links","metrics")?.id).toBe("links");
  expect(activeItem("map","impact","metrics")?.id).toBe("impact");
  expect(activeItem("fox","structure","awards")?.id).toBe("awards");
  expect(activeItem("fox","structure","metrics")?.id).toBe("metrics");
  expect(activeItem("comparison","structure","metrics")?.id).toBe("comparison");
 });
 it("поиск и масштаб — только там, где они что-то делают",()=>{
  expect([...ZOOMABLE]).toEqual(["architecture"]);
  expect(SEARCHABLE.has("fox")).toBe(false);
  expect(SEARCHABLE.has("map")).toBe(false);
  expect(PICTURE_MODES.has("map")).toBe(true);
 });
});
