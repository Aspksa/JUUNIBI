import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rm } from "../test/temp-files";
import { Organizer } from "./organizer";

describe("поведенческая память Дел", () => {
  it("переживает перезапуск и помогает оценить похожее новое дело", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-task-memory-"));
    const file = path.join(dir, "organizer.json");
    let now = Date.parse("2026-10-01T09:00:00+03:00");

    try {
      const organizer = new Organizer(file, () => now);
      await organizer.load();

      for (let index = 0; index < 2; index++) {
        const task = await organizer.addTask("Подготовить ежемесячный отчёт");
        await organizer.updateTask(task.id, {
          estimateMinutes: 60,
          dueAt: new Date(now + 2 * 60 * 60_000).toISOString(),
        });
        await organizer.updateTask(task.id, {
          dueAt: new Date(now + 3 * 60 * 60_000).toISOString(),
        });
        now += 90 * 60_000;
        await organizer.setDone(task.id, true);
        now += 24 * 60 * 60_000;
      }
      await organizer.flush();

      expect(organizer.taskMemory().totals).toMatchObject({
        completed: 2,
        moved: 2,
      });

      const reloaded = new Organizer(file, () => now);
      await reloaded.load();
      const next = await reloaded.addTask("Подготовить квартальный отчёт");
      const suggestion = reloaded.smartPriority(10).recommended.find((item) => item.id === next.id);

      expect(suggestion).toMatchObject({
        estimateMinutes: 60,
        estimateSource: "memory",
      });
      expect(suggestion?.reasons).toContain("Похожие дела часто переносились");
      expect(reloaded.taskMemory().totals.completed).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
