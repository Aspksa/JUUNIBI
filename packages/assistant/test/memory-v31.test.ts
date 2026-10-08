import { describe, expect, it } from "vitest";
import { Memory } from "../src/memory";

describe("Memory 3.1", () => {
  it("falls back when embedding provider fails", async () => {
    const m = new Memory();
    const entry = await m.add("fact", "лиса", "active");
    m.setEmbeddingProvider({ embed: async () => { throw new Error("offline"); } });
    expect((await m.searchHybrid("лиса"))[0]?.id).toBe(entry.id);
  });
  it("requires approval to replace facts", async () => {
    const m = new Memory();
    const old = await m.add("fact", "проект старый", "active");
    const proposal = await m.proposeRevision(old.id, "проект новый");
    expect(proposal?.status).toBe("pending");
    expect((await m.search("старый")).length).toBe(1);
    await m.approve(proposal!.id);
    expect(await m.search("старый")).toEqual([]);
    expect((await m.search("новый"))[0]?.id).toBe(proposal!.id);
  });
  it("reranks using optional semantic vectors", async () => {
    const m = new Memory();
    await m.add("fact", "кафе", "active");
    const preferred = await m.add("fact", "лес", "active");
    m.setEmbeddingProvider({ embed: async text => text === "лес" || text === "природа" ? [1, 0] : [0, 1] });
    expect((await m.searchHybrid("природа", 1))[0]?.id).toBe(preferred.id);
  });
  it("keeps memory context within a character budget", async () => {
    const m = new Memory();
    await m.add("fact", "лиса маленькая", "active");
    expect((await m.context("лиса", 2))).toEqual([]);
    expect((await m.context("лиса", 100))).toHaveLength(1);
  });
  it("reports semantic fallback without exposing any credential", async () => {
    const memory = new Memory();
    await memory.add("fact", "лиса", "active");
    expect(memory.embeddingDiagnostics()).toMatchObject({ configured: false, mode: "lexical" });
    memory.setEmbeddingProvider({ embed: async () => { throw new Error("unavailable"); } });
    expect((await memory.searchHybrid("лиса"))).toHaveLength(1);
    expect(memory.embeddingDiagnostics()).toMatchObject({ configured: true, checks: 1, failures: 1, mode: "hybrid" });
  });

  it("approves pending proposals only once", async () => {
    const memory = new Memory();
    const pending = await memory.add("fact", "предпочитаю тесты", "pending");
    expect(await memory.approve(pending.id)).toBe(true);
    expect(await memory.approve(pending.id)).toBe(false);
  });
  it("does not allow competing proposals to replace the same fact", async () => {
    const memory = new Memory();
    const original = await memory.add("fact", "цвет синий", "active");
    const first = await memory.proposeRevision(original.id, "цвет зелёный");
    expect(first?.status).toBe("pending");
    expect(await memory.proposeRevision(original.id, "цвет красный")).toBeNull();
    expect((await memory.search("синий"))[0]?.id).toBe(original.id);
    await memory.approve(first!.id);
    expect(await memory.search("синий")).toEqual([]);
    expect((await memory.search("зелёный"))[0]?.id).toBe(first!.id);
  });

});
