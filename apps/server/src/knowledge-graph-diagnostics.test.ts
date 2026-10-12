import { describe, expect, it } from "vitest";
import { diagnoseKnowledgeGraph, type KnowledgeNode } from "./knowledge-graph-diagnostics";
const entry=(id:string,claim:string,topic="арифметика",status:KnowledgeNode["status"]="verified"):KnowledgeNode=>({
 id,claim,topic,status,source:"test",verifiedAt:"2026-10-01",nextReviewAt:"2026-10-10",reviewCount:0
});
describe("live knowledge graph diagnostics",()=>{
 it("flags exact arithmetic conflicts without deciding who is right",()=>{
   const result=diagnoseKnowledgeGraph([entry("a","2 + 2 = 4"),entry("b","2 + 2 = 5")],new Date("2026-10-12"));
   expect(result.conflicts).toHaveLength(1);
   expect(result.conflicts[0]?.verified).toBe(false);
 });
 it("does not compare distinct expressions or unverified claims",()=>{
   const result=diagnoseKnowledgeGraph([entry("a","2 + 2 = 4"),entry("b","2 + 3 = 6"),entry("c","2 + 2 = 6","арифметика","needs-review")]);
   expect(result.conflicts).toHaveLength(0);
 });
 it("reports due knowledge and topic coverage",()=>{
   const result=diagnoseKnowledgeGraph([entry("a","2 × 3 = 6"),entry("b","2 × 3 = 6")],new Date("2026-10-12"));
   expect(result.due).toBe(2); expect(result.coverage[0]?.total).toBe(2);
 });
});
