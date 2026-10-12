import {describe,it,expect} from "vitest";
import {treeDevelopmentRoute} from "./kitsune-tree-routes";
import type {TreeHealthNode} from "./kitsune-tree-health";
const n=(id:string,status:TreeHealthNode["status"],dependsOn:string[]=[]):TreeHealthNode=>({id,title:id,status,dependsOn,stage:0});
describe("Fox Tree development routes",()=>{
 it("orders dependencies before the destination and captures downstream impact",()=>{
  const x=treeDevelopmentRoute([n("core","implemented"),n("brain","implemented",["core"]),n("memory","planned",["brain"]),n("search","planned",["memory"])],"memory");
  expect(x.steps.map(s=>s.id)).toEqual(["core","brain","memory"]);
  expect(x.ready).toBe(true);expect(x.affected).toEqual(["search"]);
 });
 it("does not present blocked or missing branches as ready",()=>{
  const x=treeDevelopmentRoute([n("a","planned",["b"]),n("b","planned",["missing"])],"a");
  expect(x.ready).toBe(false);expect(x.missing).toEqual(["missing"]);
 });
 it("detects cycles without recursive overflow",()=>{
  const x=treeDevelopmentRoute([n("a","planned",["b"]),n("b","planned",["a"])],"a");
  expect(x.cycles).toHaveLength(1);expect(x.ready).toBe(false);
 });
});
