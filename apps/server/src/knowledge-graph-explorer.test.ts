import {describe,it,expect} from "vitest";
import {exploreKnowledge,exploreKnowledgeNeighbors} from "./knowledge-graph-explorer";
import type {KnowledgeNode} from "./knowledge-graph-diagnostics";
const node=(id:string,claim:string,topic:string,status:KnowledgeNode["status"]="verified"):KnowledgeNode=>({id,claim,topic,status,source:"owner",verifiedAt:"2026-01-01",nextReviewAt:"2027-01-01",reviewCount:0});
describe("evidence aware knowledge search",()=>{
 it("finds verified nodes with explainable overlap",()=>{
  const x=exploreKnowledge([node("1","Память хранит решения","система памяти"),node("2","Память без проверки","система памяти","needs-review")],"память");
  expect(x.items.map(y=>y.id)).toEqual(["1"]);expect(x.items[0]?.shared).toContain("память");
 });
 it("does not hallucinate connections or expose unverified records",()=>{
  const records=[node("a","граф связей памяти","система знаний"),node("b","граф связей решений","система знаний"),node("c","граф связи","система знаний","needs-review")];
  expect(exploreKnowledgeNeighbors(records,"a").items.map(x=>x.id)).toEqual(["b"]);
  expect(exploreKnowledgeNeighbors(records,"c").items).toEqual([]);
 });
 it("rejects oversized queries and invalid result limits",()=>{
  expect(()=>exploreKnowledge([],"x".repeat(501))).toThrow();
  expect(()=>exploreKnowledge([],"память",new Date(),0)).toThrow();
 });
});
