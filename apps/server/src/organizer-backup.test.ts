import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer } from "./organizer";

describe("organizer snapshots", () => {
  it("restores the previous valid file when the current one is truncated", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-snapshot-"));
    const file = path.join(dir, "tasks.json");
    try {
      const org = new Organizer(file);
      await org.load();
      await org.addNote("note", "Important older note");
      await org.addNote("note", "Second note");
      expect(JSON.parse(await readFile(file + ".bak", "utf8")).notes).toHaveLength(1);
      await writeFile(file, "{bad JSON");
      const reloaded = new Organizer(file);
      await reloaded.load();
      expect(reloaded.listNotes().map(n => n.text)).toEqual(["Important older note"]);
      await reloaded.addNote("note", "New note after recovery");
      expect(JSON.parse(await readFile(file + ".bak", "utf8")).notes).toHaveLength(1);
      expect(JSON.parse(await readFile(file, "utf8")).notes).toHaveLength(2);
    } finally { await rm(dir, { recursive:true, force:true }); }
  });
  it("does not silently ignore corruption without a valid backup", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-snapshot-"));
    const file = path.join(dir, "tasks.json");
    try {
      await writeFile(file, "{broken");
      await expect(new Organizer(file).load()).rejects.toThrow();
    } finally { await rm(dir, { recursive:true, force:true }); }
  });
});
