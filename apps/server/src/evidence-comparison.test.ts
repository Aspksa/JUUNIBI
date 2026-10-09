import { expect, it, vi } from "vitest";
import { comparePublicEvidence } from "./evidence-comparison";
it("requires independent sources and never promotes evidence automatically", async () => {
  const checker = vi.fn(async (source: unknown, _section: unknown, quote: unknown) =>
    ({ source: String(source), quote: String(quote), matched: true, retrievedAt: "2026-10-09" }));
  const entries = [{source:"nasa",section:"",quote:"a".repeat(35)},{source:"britannica",section:"",quote:"b".repeat(35)}];
  const result = await comparePublicEvidence(entries, checker);
  expect(result.corroborated).toBe(true);
  expect(result.promotesToMemory).toBe(false);
  expect(result.distinctSources).toBe(2);
  await expect(comparePublicEvidence([entries[0], entries[0]], checker)).rejects.toThrow();
  expect(checker).toHaveBeenCalledTimes(2);
});
it("keeps partially matched evidence unconfirmed", async () => {
  const checker = vi.fn(async (source: unknown) => ({ source: String(source), quote: "x", matched: source === "nasa", retrievedAt: "2026-10-09" }));
  const r = await comparePublicEvidence([{source:"nasa",section:"",quote:"a".repeat(35)},{source:"mdn",section:"",quote:"b".repeat(35)}], checker);
  expect(r.corroborated).toBe(false);
});
