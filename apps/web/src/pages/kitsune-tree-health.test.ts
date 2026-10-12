import {describe,it,expect} from "vitest";
import {assessTreeHealth,type TreeHealthNode} from "./kitsune-tree-health";
const node=(id:string,status:TreeHealthNode["status"],dependsOn:string[]=[]):TreeHealthNode=>({id,title:id,status,dependsOn,stage:0});
describe("Fox Tree health",()=>{
 it("identifies ready and blocked planned branches",()=>{
  const r=assessTreeHealth([node("root","implemented"),node("a","planned",["root"]),node("b","planned",["a"])]);
  expect(r.ready).toEqual(["a"]);expect(r.blocked).toEqual([{id:"b",dependencies:["a"]}]);
 });
 it("reports missing dependencies and cycles without changing input",()=>{
  const records=[node("a","planned",["b","absent"]),node("b","planned",["a"])];
  const r=assessTreeHealth(records);
  expect(r.missing).toEqual([{id:"a",dependency:"absent"}]);expect(r.cycles).toHaveLength(1);
  expect(records[0]?.dependsOn).toEqual(["b","absent"]);
 });
 it("ranks impacted hotspots deterministically",()=>{
  const r=assessTreeHealth([node("root","implemented"),node("a","planned",["root"]),node("b","planned",["root"])]);
  expect(r.hotspots[0]).toEqual({id:"root",dependents:2});
 });
});
