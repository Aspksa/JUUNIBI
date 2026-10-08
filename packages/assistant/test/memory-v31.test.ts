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
});
