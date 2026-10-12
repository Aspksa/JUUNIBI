import {describe,expect,it} from "vitest";
import {KNOWN_SOURCES,connectGuide} from "./kitsune-connect";
import {readFileSync} from "node:fs";
// state.ts обращается к location при загрузке, поэтому список страниц читаем из исходника.
const ROUTES=(/export const ROUTES: Route\[\] = \[([^\]]*)\]/.exec(readFileSync(new URL("../state.ts",import.meta.url),"utf8"))?.[1]??"").split(",").map(s=>s.trim().replace(/"/g,"")).filter(Boolean);

describe("как подключить показатель",()=>{
 it("у известного источника есть шаги и переход в нужный раздел",()=>{
  const g=connectGuide("Органайзер");
  expect(g.steps.length).toBeGreaterThanOrEqual(2);
  expect(g.route).toBe("tasks");
 });
 it("список страниц прочитан",()=>{expect(ROUTES.length).toBeGreaterThan(8);});
 it("переходы ведут только в существующие страницы, всё на русском",()=>{
  for(const s of KNOWN_SOURCES){
   const g=connectGuide(s);
   if(g.route)expect(ROUTES).toContain(g.route);
   expect(g.steps.join(" ").replace(/GitHub|JUUNIBI/g,"")).not.toMatch(/[A-Za-z]{4,}/);
  }
 });
 it("источник «ещё не подключён» не превращается в совет «обновите страницу»",()=>{
  const g=connectGuide("Источник ещё не подключён");
  expect(g.steps[0]).toMatch(/нет источника/);
  expect(g.steps.join(" ")).not.toContain("«Источник ещё");
 });
 it("незнакомый источник получает общий совет с его названием",()=>{
  const g=connectGuide("Неведомый");
  expect(g.steps[0]).toContain("Неведомый");
  expect(g.route).toBeUndefined();
 });
});
