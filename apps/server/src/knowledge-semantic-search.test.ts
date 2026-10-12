import {describe,it,expect} from "vitest";
import {searchKnowledgeSemantic} from "./knowledge-semantic-search";
import type {KnowledgeNode} from "./knowledge-graph-diagnostics";
const n=(id:string,status:KnowledgeNode["status"]="verified"):KnowledgeNode=>({id,topic:"память",claim:"Система поиска",source:"test",status,verifiedAt:"2026-01-01",nextReviewAt:"2027-01-01",reviewCount:0});
describe("hybrid knowledge retrieval",()=>{
 it("falls back to lexical when no provider is configured",async()=>{
  const x=await searchKnowledgeSemantic([n("1")],"память");
  expect(x.searchMode).toBe("lexical");expect(x.items[0]?.id).toBe("1");
 });
 it("does not rank unverified knowledge",async()=>{
  const provider={id:"test",embed:async(_:string)=>[1,0]};
  const x=await searchKnowledgeSemantic([n("1"),n("2","needs-review")],"семантика",provider);
  expect(x.items.map(a=>a.id)).toEqual(["1"]);
 });
 it("falls back when vectors are malformed",async()=>{
  const x=await searchKnowledgeSemantic([n("1")],"память",{id:"broken",embed:async()=>[NaN]});
  expect(x.searchMode).toBe("lexical-fallback");
 });
});
