import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { KnowledgeLedger } from "./knowledge-ledger";

describe("Brain 4.0 knowledge ledger", () => {
  it("requires trusted provenance and rejects arbitrary promotion", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-ledger-"));
    try {
      const ledger = new KnowledgeLedger(path.join(dir, "k.json"));
      expect(() => ledger.addVerified({ topic: "math", claim: "2+2=4", source: "LLM", evidence: "model" as never })).toThrow();
      const item = ledger.addVerified({ topic: "math", claim: "2+2=4", source: "independent arithmetic", evidence: "deterministic-test" });
      expect(ledger.list()).toHaveLength(1);
      expect(ledger.addVerified({ topic: "math", claim: "2+2=4", source: "test", evidence: "owner-confirmed" }).id).toBe(item.id);
      await ledger.flush();
      const restored = new KnowledgeLedger(path.join(dir, "k.json"));
      await restored.load();
      expect(restored.list()).toHaveLength(1);
      expect(restored.due(new Date(Date.now() + 3 * 86400000))).toHaveLength(1);
      expect(restored.review(item.id, false).status).toBe("needs-review");
      await restored.flush();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
