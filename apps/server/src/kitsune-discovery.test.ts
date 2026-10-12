import {describe,it,expect} from "vitest";
import {analyzeModuleGraph} from "./kitsune-discovery";
describe("Kitsune 7 read-only repository discovery",()=>{
 it("extracts local imports and detects cycles without executing files",()=>{
  const report=analyzeModuleGraph({
   "apps/server/src/a.ts":'import {b} from "./b"; export const a=1;',
   "apps/server/src/b.ts":'import {a} from "./a"; export const b=1;',
   "apps/server/src/extra.ts":'export const module=1'
  },["a"]);
  expect(report.scanned).toBe(3);
  expect(report.cycles).toHaveLength(1);
  expect(report.candidates.some(x=>x.id==="extra")).toBe(true);
  expect(report.unresolved).toHaveLength(0);
 });
 it("reports unresolved imports and possible manifest gaps without claiming capabilities",()=>{
  const report=analyzeModuleGraph({"apps/web/src/pages/fox.ts":'import foo from "./missing";'},["brain"]);
  expect(report.unresolved).toContain("apps/web/src/pages/fox.ts → ./missing");
  expect(report.manifestGaps).toContain("brain");
  expect(report.candidates[0]?.candidate).toBe(true);
 });
 it("файлы тестов не предлагаются как новые модули",()=>{
  const report=analyzeModuleGraph({"apps/server/src/real.ts":"export const r=1","apps/server/src/real.test.ts":'import {r} from "./real";',"apps/web/src/pages/x.spec.ts":"export {}"},[]);
  expect(report.candidates.map(x=>x.file)).toEqual(["apps/server/src/real.ts"]);
  expect(report.scanned).toBe(3);
 });
 it("импорты только типов не образуют циклов, а обычные — образуют",()=>{
  const typeOnly=analyzeModuleGraph({
   "apps/server/src/a.ts":'import type {B} from "./b";\nexport interface A{b:B}',
   "apps/server/src/b.ts":'import {a} from "./a";\nexport type B={a:typeof a};\nexport const b=1;'
  },[]);
  expect(typeOnly.cycles).toHaveLength(0);
  const multiLine=analyzeModuleGraph({
   "apps/server/src/a.ts":'import type {\n  B,\n  C\n} from "./b";\nexport const a=1;',
   "apps/server/src/b.ts":'import {a} from "./a";\nexport type B=1;export type C=2;'
  },[]);
  expect(multiLine.cycles).toHaveLength(0);
  const real=analyzeModuleGraph({
   "apps/server/src/a.ts":'import {b} from "./b"; export const a=1;',
   "apps/server/src/b.ts":'import {a} from "./a"; export const b=1;'
  },[]);
  expect(real.cycles).toHaveLength(1);
 });
});
