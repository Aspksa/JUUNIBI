import { describe, expect, it } from "vitest";
import { Memory, MemoryAdapter } from "../src/memory";

describe("Memory 3.0", () => {
  it("searches Russian text and related concepts", async () => {
    const memory = new Memory(new MemoryAdapter());
    const a = await memory.add("fact", "Моя помощница работает с проектом", "active");
    expect((await memory.search("помощник"))[0]?.id).toBe(a.id);
    expect((await memory.search("ПРОЕКТ"))[0]?.id).toBe(a.id);
    expect((await memory.search("несуществующее"))).toEqual([]);
  });
  it("excludes expired and replaced facts while preserving history", async () => {
    const memory = new Memory();
    const old = await memory.add("fact", "старый ассистент", "active");
    const current = await memory.add("fact", "новый помощник", "active");
    expect(await memory.supersede(old.id, current.id)).toBe(true);
    expect((await memory.search("старый"))).toEqual([]);
    expect((await memory.list())).toHaveLength(2);
    expect(await memory.setExpiry(current.id, Date.now() - 1000)).toBe(true);
    expect((await memory.search("помощник"))).toEqual([]);
    expect(await memory.setExpiry(current.id, null)).toBe(true);
    expect((await memory.search("помощник"))[0]?.id).toBe(current.id);
  });
  it("links only confirmed facts without auto-approving pending memory", async () => {
    const memory = new Memory();
    const a = await memory.add("fact", "встреча", "active");
    const b = await memory.add("fact", "расписание", "pending");
    expect(await memory.relate(a.id, b.id)).toBe(false);
    await memory.approve(b.id);
    expect(await memory.relate(a.id, b.id)).toBe(true);
    expect((await memory.list())[0]?.relatedIds).toContain(b.id);
    expect(await memory.supersede(a.id, a.id)).toBe(false);
  });
});
