import { describe, expect, it } from "vitest";
import { KnowledgeLedger } from "./knowledge-ledger";
import { mkdtemp } from "node:fs/promises";
import { rm } from "../test/temp-files";
import { tmpdir } from "node:os";
import path from "node:path";

describe("live knowledge embeddings", () => {
  it("uses the configured provider and falls back when disabled", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "juunibi-live-embedding-"));
    try {
      const ledger = new KnowledgeLedger(path.join(dir, "knowledge.json"));
      ledger.addVerified({ topic: "память", claim: "Поиск важных знаний", source: "owner", evidence: "owner-confirmed" });
      await ledger.flush();
      const provider = { id: "fake", embed: async (_value: string) => [1, 0] };
      ledger.setEmbeddingProvider(provider);
      const semantic = await ledger.semanticSearch("релевантность");
      expect(semantic.searchMode).toBe("hybrid");
      expect(semantic.items).toHaveLength(1);
      ledger.setEmbeddingProvider(undefined);
      const lexical = await ledger.semanticSearch("память");
      expect(lexical.searchMode).toBe("lexical");
      expect(lexical.items).toHaveLength(1);
      await ledger.flush();
    } finally { await rm(dir, {recursive:true,force:true}); }
  });
});
