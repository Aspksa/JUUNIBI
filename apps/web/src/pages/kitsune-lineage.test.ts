import {describe,it,expect} from "vitest";
import {traceCapabilities,evolutionChronology,architecturePrompt} from "./kitsune-lineage";
import type {EvolutionNode} from "./kitsune-evolution-model";
const sha="c6e12f2ddfc2479f18cd229833f7c912f222652d";
const nodes:EvolutionNode[]=[
 {id:"core",title:"Core",description:"Base",how:"Runs",status:"implemented",stage:0,dependsOn:[]},
 {id:"brain",title:"Brain",description:"Planning",how:"Plans",status:"implemented",stage:1,dependsOn:["core"],introducedIn:{sha,pr:269}},
 {id:"future",title:"Future",description:"Pending",how:"Planned",status:"planned",stage:2,dependsOn:["brain"]}
];
describe("Kitsune verified provenance",()=>{
 it("never treats a different SHA as proof of installation",()=>{
  expect(traceCapabilities(nodes,"different",[])[1]?.installation).toBe("unverified");
  expect(traceCapabilities(nodes,sha,[])[1]?.installation).toBe("current");
 });
 it("distinguishes historical presence from active revision",()=>{
  expect(traceCapabilities(nodes,"other",[{from:"base",to:sha,kind:"install"}])[1]?.installation).toBe("recorded");
 });
 it("sorts history without changing original data",()=>{
  const h=[{id:"old",at:"2026-01-01",kind:"install",to:"a",message:""},
           {id:"new",at:"2026-02-01",kind:"rollback",to:"b",message:""}];
  expect(evolutionChronology(h).map(x=>x.id)).toEqual(["new","old"]);
  expect(h[0]?.id).toBe("old");
 });
 it("prepares non-executing architecture analysis text",()=>{
  const prompt=architecturePrompt(nodes[2]!,nodes);
  expect(prompt).toContain("Brain (implemented)");
  expect(prompt).toContain("не изменяй без моего подтверждения");
 });
});