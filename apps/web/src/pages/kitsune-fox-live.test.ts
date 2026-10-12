import {describe,expect,it} from "vitest";
import {foxMetrics} from "./kitsune-fox-metrics";
import type {EvolutionNode} from "./kitsune-evolution-model";
const nodes:EvolutionNode[]=[{id:"core",title:"Core",description:"",how:"",status:"implemented",stage:0,dependsOn:[]}];
describe("Fox live sources",()=>{
 it("isolates missing feeds rather than returning fabricated zeroes",()=>{
  const metrics=foxMetrics({nodes,snapshot:null,growth:[],live:{}});
  expect(metrics[10]?.value).toBeNull();
  expect(metrics[40]?.value).toBeNull();
  expect(metrics[73]?.value).toBeNull();
 });
 it("maps current Brain plan state without guessing",()=>{
  const metrics=foxMetrics({nodes,snapshot:null,growth:[],live:{brain:{mode:"chat",assistantReady:true,capabilities:[],plans:[{id:"1",goal:"x",createdAt:"today",status:"completed",steps:[]}]}}});
  expect(metrics[11]?.value).toBe(1);
  expect(metrics[24]?.value).toBe(0);
  expect(metrics[10]?.value).toBeNull();
 });
});
