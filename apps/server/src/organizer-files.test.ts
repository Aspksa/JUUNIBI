import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Organizer, cleanLinks } from "./organizer";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";

describe("Files from «Диск» on to-dos and projects", () => {
  it("attaches, keeps across a reload and a repeat, and detaches", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-org-files-"));
    try {
      const file = path.join(dir, "o.json");
      const o = new Organizer(file);
      const t = await o.addTask("Оплатить аренду", { dueAt: "2026-10-12T10:00:00Z", repeat: "monthly" });
      await o.updateTask(t.id, { files: [{ id: A, name: "счёт.pdf" }, { id: A, name: "дубль" }, { id: "bad", name: "x" }] });
      const again = new Organizer(file); await again.load();
      expect(again.listNotes().find((n) => n.id === t.id)?.files).toEqual([{ id: A, name: "счёт.pdf" }]);
      const done = await again.setDone(t.id, true);
      const next = again.listNotes().find((n) => n.id === done.nextId);
      expect(next?.files).toEqual([{ id: A, name: "счёт.pdf" }]);
      await again.updateTask(t.id, { files: null });
      expect(again.listNotes().find((n) => n.id === t.id)?.files).toBeUndefined();
      await expect(again.updateTask(t.id, { files: "x" })).rejects.toMatchObject({ status: 400 });
      // a project with only files attached is remembered
      const p = await again.setProject("Ремонт", { files: [{ id: B, name: "смета.xlsx" }] });
      expect(p.files).toEqual([{ id: B, name: "смета.xlsx" }]);
      expect(again.listProjects().find((x) => x.name === "Ремонт")?.files?.length).toBe(1);
      await again.setProject("Ремонт", { files: null });
      expect(again.listProjects().some((x) => x.name === "Ремонт")).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("cleans links: distinct ids, names trimmed, at most 20", () => {
    expect(cleanLinks("x")).toBeUndefined();
    expect(cleanLinks([])).toBeUndefined();
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`, name: " f" + i + " " }));
    const out = cleanLinks(many)!;
    expect(out).toHaveLength(20);
    expect(out[0]).toEqual({ id: many[0]!.id, name: "f0" });
  });
});
