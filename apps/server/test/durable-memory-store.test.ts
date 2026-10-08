import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { durableMemoryStore } from "../src/durable-memory-store";

describe("durable memory backup", () => {
  it("preserves prior valid snapshot and recovers a damaged primary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "juunibi-memory-"));
    const file = path.join(dir, "memory.json");
    try {
      const store = durableMemoryStore(file);
      await store.save(JSON.stringify([{ id: "old" }]));
      await store.save(JSON.stringify([{ id: "new" }]));
      expect(JSON.parse(await readFile(file + ".bak", "utf8"))).toEqual([{ id: "old" }]);
      await writeFile(file, "{broken");
      expect(JSON.parse((await store.load())!)).toEqual([{ id: "old" }]);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual([{ id: "old" }]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("refuses to overwrite corrupt user data when no valid backup exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "juunibi-memory-"));
    const file = path.join(dir, "memory.json");
    try {
      await writeFile(file, "{broken");
      const store = durableMemoryStore(file);
      await expect(store.load()).rejects.toThrow(/Память повреждена/);
      await expect(store.save("[]")).rejects.toThrow(/Память повреждена/);
      expect(await readFile(file, "utf8")).toBe("{broken");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
