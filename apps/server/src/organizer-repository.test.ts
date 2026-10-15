import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OrganizerRepository } from "./organizer-repository";

describe("OrganizerRepository", () => {
  it("serializes writes and keeps the previous valid snapshot as backup", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-organizer-repo-"));
    const file = path.join(dir, "organizer.json");
    try {
      const repo = new OrganizerRepository(file);
      await repo.save({ version: 1 });
      await repo.save({ version: 2 });
      await repo.flush();

      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 2 });
      expect(JSON.parse(await readFile(file + ".bak", "utf8"))).toEqual({ version: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads the backup when the main snapshot is corrupt", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-organizer-repo-"));
    const file = path.join(dir, "organizer.json");
    try {
      await writeFile(file, "{broken");
      await writeFile(file + ".bak", JSON.stringify({ recovered: true }));
      const repo = new OrganizerRepository(file);
      expect(await repo.load()).toEqual({ recovered: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads the backup when the main snapshot is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-organizer-repo-"));
    const file = path.join(dir, "organizer.json");
    try {
      await writeFile(file + ".bak", JSON.stringify({ recovered: "backup" }));
      const repo = new OrganizerRepository(file);
      expect(await repo.load()).toEqual({ recovered: "backup" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not hide corrupt data when no valid backup exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-organizer-repo-"));
    const file = path.join(dir, "organizer.json");
    try {
      await writeFile(file, "{broken");
      const repo = new OrganizerRepository(file);
      await expect(repo.load()).rejects.toBeInstanceOf(SyntaxError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite a good backup with a corrupt main during recovery", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-organizer-repo-"));
    const file = path.join(dir, "organizer.json");
    try {
      await writeFile(file, "{broken");
      await writeFile(file + ".bak", JSON.stringify({ version: 1 }));
      const repo = new OrganizerRepository(file);
      expect(await repo.load()).toEqual({ version: 1 });

      await repo.save({ version: 2 });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 2 });
      expect(JSON.parse(await readFile(file + ".bak", "utf8"))).toEqual({ version: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
