import { describe, expect, it } from "vitest";
import { Memory, MemoryAdapter } from "../src/memory";

describe("Memory retrieval v2", () => {
  it("deduplicates Unicode case, ё and whitespace without silently approving proposals", async () => {
    const m = new Memory(new MemoryAdapter());
    const pending = await m.add("fact", "  Ёж   живёт дома ", "pending");
    const same = await m.add("fact", "еж живёт дома", "pending");
    expect(same.id).toBe(pending.id);
    expect((await m.search("еж")).length).toBe(0);
    await m.approve(pending.id);
    expect((await m.search("ЕЖ"))[0]?.id).toBe(pending.id);
  });
  it("uses distinct matching tokens, respects k and protects stored records from mutation", async () => {
    const m = new Memory();
    const a = await m.add("fact", "лиса лиса помощница", "active");
    const b = await m.add("fact", "лиса другое", "active");
    expect((await m.search("лиса помощница"))[0]?.id).toBe(a.id);
    expect(await m.search("лиса", 0)).toEqual([]);
    const items = await m.list();
    items[0]!.text = "mutated";
    expect((await m.list())[0]?.text).toBe("лиса лиса помощница");
    expect((await m.search("лиса", 1))).toHaveLength(1);
    expect((await m.search("другое"))[0]?.id).toBe(b.id);
  });
});
