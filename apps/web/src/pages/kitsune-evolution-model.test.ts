import {describe,it,expect} from "vitest";
import {validateEvolutionManifest,recommendEvolution} from "./kitsune-evolution-model";
const manifest={schemaVersion:1,project:"JUUNIBI",nodes:[
 {id:"core",title:"Core",description:"Root",how:"Starts",status:"implemented",dependsOn:[],stage:0},
 {id:"next",title:"Next",description:"Future",how:"Planned",status:"planned",dependsOn:["core"],stage:1}
]};
describe("Kitsune Evolution v2",()=>{
 it("validates a versioned manifest and produces safe, read-only advice",()=>{
  const valid=validateEvolutionManifest(manifest);
  expect(valid.nodes).toHaveLength(2);
  expect(recommendEvolution(valid)[0]).toMatchObject({nodeId:"next",ready:true,executesAutomatically:false});
 });
 it("rejects missing links, duplicate ids, and cycles",()=>{
  expect(()=>validateEvolutionManifest({...manifest,nodes:[manifest.nodes[0],manifest.nodes[0]]})).toThrow();
  expect(()=>validateEvolutionManifest({...manifest,nodes:[manifest.nodes[0],{...manifest.nodes[1],dependsOn:["missing"]}]})).toThrow();
  expect(()=>validateEvolutionManifest({...manifest,nodes:[{...manifest.nodes[0],dependsOn:["next"]},manifest.nodes[1]]})).toThrow();
 });
});
