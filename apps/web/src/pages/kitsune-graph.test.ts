import {describe,it,expect} from "vitest";
import {defaultPositions,cleanPositions} from "./kitsune-graph";
import type {EvolutionNode} from "./kitsune-evolution-model";
const nodes:EvolutionNode[]=[
 {id:"core",title:"Core",description:"",how:"",status:"implemented",dependsOn:[],stage:0},
 {id:"brain",title:"Brain",description:"",how:"",status:"implemented",dependsOn:["core"],stage:1}
];
describe("Kitsune spatial graph",()=>{
 it("separates levels and produces stable coordinates",()=>{
  expect(defaultPositions(nodes).brain?.x).toBeGreaterThan(defaultPositions(nodes).core!.x);
  expect(defaultPositions([...nodes].reverse())).toEqual(defaultPositions(nodes));
 });
 it("rejects invalid or forged node positions",()=>{
  const result=cleanPositions({brain:{x:125,y:235},core:{x:-7,y:Infinity},intruder:{x:2,y:3}},nodes);
  expect(result.brain).toEqual({x:125,y:235});
  expect(result.core).toEqual(defaultPositions(nodes).core);
  expect(result).not.toHaveProperty("intruder");
 });
});