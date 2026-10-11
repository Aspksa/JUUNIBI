import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer } from "./organizer";

const local = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min).getTime();

describe("«Готово» на «Итоге дня» и «Обзоре недели»", () => {
  it("закрытые напоминания не возвращаются ни при следующих проверках, ни после перезапуска", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-dismiss-"));
    const file = path.join(dir, "o.json");
    let t = local(11, 20); // воскресенье
    try {
      const o = new Organizer(file, () => t);
      await o.load();
      await o.setAutomation({ brief: false, evening: true, weekly: true, eveningTime: "21:00" });
      t = local(11, 21);
      await o.tick();
      const due = () => o.listReminders().filter((r) => r.status === "due");
      expect(due().map((r) => r.source).sort()).toEqual(["evening", "week"]);
      for (const r of due()) await o.dismissReminder(r.id);
      for (let m = 1; m < 60; m += 5) { t = local(11, 21, m); await o.tick(); }
      expect(due()).toEqual([]);
      await o.flush();
      const again = new Organizer(file, () => t);
      await again.load();
      await again.tick();
      expect(again.listReminders().filter((r) => r.status === "due")).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("вчерашний «Итог дня» без «Готово» закрывается, когда приходит сегодняшний", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-dismiss-"));
    let t = local(12, 20);
    try {
      const o = new Organizer(path.join(dir, "o.json"), () => t);
      await o.load();
      await o.setAutomation({ brief: false, evening: true, weekly: false, eveningTime: "21:00" });
      t = local(12, 21); await o.tick();
      t = local(13, 21); await o.tick();
      const eve = o.listReminders().filter((r) => r.source === "evening");
      expect(eve).toHaveLength(2);
      expect(eve.filter((r) => r.status === "due")).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
