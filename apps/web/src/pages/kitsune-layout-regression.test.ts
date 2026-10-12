import {describe,it,expect} from "vitest";
import {scaledScrollBounds,defaultPositions} from "./kitsune-graph";
import type {EvolutionNode} from "./kitsune-evolution-model";
describe("Kitsune canvas regression",()=>{
 it("reserves full scroll area for zoom above 100%",()=>{
  expect(scaledScrollBounds(1000,600,1.5)).toEqual({x:1500,y:900});
 });
 it("keeps scroll extent proportional when zoomed out",()=>{
  expect(scaledScrollBounds(1000,600,.6)).toEqual({x:600,y:360});
 });
 it("clamps nonfinite/oversized scale",()=>{
  expect(scaledScrollBounds(1000,600,Infinity)).toEqual({x:1000,y:600});
  expect(scaledScrollBounds(1000,600,9)).toEqual({x:1500,y:900});
 });
 it("keeps stable coordinates when rendering from same data",()=>{
  const nodes:EvolutionNode[]=[{id:"core",title:"Core",description:"",how:"",status:"implemented",dependsOn:[],stage:0}];
  expect(defaultPositions(nodes)).toEqual(defaultPositions(nodes));
 });
});