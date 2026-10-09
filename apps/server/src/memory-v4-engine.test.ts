import { describe, expect, it } from "vitest";
import { analyzeMemoryV4 } from "./memory-v4-engine";
import type { VerifiedKnowledge } from "./knowledge-ledger";
const make=(id:string,claim:string,status:"verified"|"needs-review"="verified",topic="учеба"):VerifiedKnowledge=>({
 id,topic,claim,source:"owner",verifiedAt:"2026-01-01T00:00:00.000Z",
 nextReviewAt:"2026-01-02T00:00:00.000Z",reviewCount:0,status
});
describe("Memory Engine 4.0",()=>{
 it("recalls only verified records; quarantine is maintained",()=>{
  const r=analyzeMemoryV4([make("a","доказанное правило"),make("b","запрещённый вымысел","needs-review")],"правило");
  expect(r.recall.map(x=>x.id)).toEqual(["a"]);
  expect(r.stats.verified).toBe(1);
  expect(r.dueForReview).toContain("b");
 });
 it("finds duplicate candidates, topic links and potential negation conflicts without mutation",()=>{
  const items=[make("a","важно"),make("b"," ВАЖНО "),make("c","не важно")];
  const before=JSON.stringify(items);
  const r=analyzeMemoryV4(items,"важно");
  expect(r.duplicateGroups).toContainEqual(["a","b"]);
  expect(r.links.length).toBeGreaterThan(0);
  expect(r.links.every(x=>x.verified===false)).toBe(true);
  expect(r.potentialConflicts.length).toBeGreaterThan(0);
  expect(JSON.stringify(items)).toBe(before);
 });
 it("does not infer contradictions from different topics",()=>{
  const r=analyzeMemoryV4([make("a","проект готов", "verified","alpha"),make("b","не проект готов","verified","beta")],"проект");
  expect(r.potentialConflicts).toHaveLength(0);
 });
});
