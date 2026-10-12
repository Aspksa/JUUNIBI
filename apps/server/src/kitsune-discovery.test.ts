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
});