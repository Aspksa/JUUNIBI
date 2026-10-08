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

  it("cleans links and restores visibility when a replacement is forgotten", async () => {
    const memory = new Memory();
    const original = await memory.add("fact", "старая тема", "active");
    const related = await memory.add("fact", "связанная тема", "active");
    await memory.relate(original.id, related.id);
    const replacement = await memory.proposeRevision(original.id, "новая тема");
    await memory.approve(replacement!.id);
    expect(await memory.search("старая")).toEqual([]);
    await memory.forget(replacement!.id);
    expect((await memory.search("старая"))[0]?.id).toBe(original.id);
    await memory.forget(related.id);
    expect((await memory.list()).find(e => e.id === original.id)?.relatedIds).toEqual([]);
  });
  it("rejects stale replacement proposals rather than approving contradictory facts", async () => {
    const memory = new Memory();
    const original = await memory.add("fact", "параметр старый", "active");
    const candidate = await memory.proposeRevision(original.id, "параметр новый");
    const another = await memory.add("fact", "параметр современный", "active");
    await memory.supersede(original.id, another.id);
    expect(await memory.approve(candidate!.id)).toBe(false);
    expect((await memory.list("pending")).some(e => e.id === candidate!.id)).toBe(true);
  });

  it("prioritizes stable preferences over equally relevant facts", async () => {
    const memory = new Memory();
    await memory.add("fact", "цвет синий", "active");
    const preference = await memory.add("preference", "цвет зелёный", "active");
    expect((await memory.search("цвет"))[0]?.id).toBe(preference.id);
  });
  it("feedback affects ranking but cannot overcome stronger text relevance", async () => {
    const memory = new Memory();
    const strong = await memory.add("fact", "синий цвет оформление", "active");
    const weak = await memory.add("fact", "синий фон", "active");
    await memory.feedback([weak.id], 100);
    expect((await memory.search("синий цвет оформление"))[0]?.id).toBe(strong.id);
    await memory.feedback([strong.id], 2);
    expect((await memory.search("синий"))[0]?.id).toBe(strong.id);
  });
  it("excludes unapproved, expired and superseded facts from ranked retrieval", async () => {
    const memory = new Memory();
    const old = await memory.add("preference", "тема тёмная", "active");
    const proposal = await memory.proposeRevision(old.id, "тема светлая");
    expect((await memory.search("светлая"))).toEqual([]);
    await memory.approve(proposal!.id);
    expect(await memory.search("тёмная")).toEqual([]);
    await memory.setExpiry(proposal!.id, Date.now() - 1);
    expect(await memory.search("светлая")).toEqual([]);
  });

});
