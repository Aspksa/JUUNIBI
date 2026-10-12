import {describe,it,expect} from "vitest";
import {downstreamImpact,compareManifests,architectureQuestion} from "./kitsune-impact";
import type {EvolutionNode} from "./kitsune-evolution-model";
const node=(id:string,dependsOn:string[]=[]):EvolutionNode=>({id,title:id,description:"description",how:"method",status:"implemented",dependsOn,stage:0});
const nodes=[node("core"),node("brain",["core"]),node("memory",["brain"]),node("agent",["brain"])];
describe("Kitsune 5 impact and architecture",()=>{
 it("finds transitive dependents deterministically",()=>expect(downstreamImpact(nodes,"core").map(x=>[x.id,x.distance])).toEqual([["brain",1],["agent",2],["memory",2]]));
 it("does not confuse identical snapshots with different release versions",()=>expect(compareManifests(nodes,nodes)).toMatchObject({added:[],removed:[],uncertain:[]}));
 it("reports added and changed nodes",()=>expect(compareManifests(nodes,[node("core"),node("new")])).toMatchObject({added:["new"],removed:["brain","memory","agent"]}));
 it("includes boundaries and caps user input",()=>{
  const s=architectureQuestion(nodes,"brain","q".repeat(3000));
  expect(s).toContain("Никаких действий без разрешения");
  expect(s).not.toContain("q".repeat(3000));
  expect(()=>architectureQuestion(nodes,"missing","hi")).toThrow();
 });
});