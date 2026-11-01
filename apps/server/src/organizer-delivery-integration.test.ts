import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Organizer } from "./organizer";

describe("durable reminder delivery integration", () => {
  it("stores fired deliveries across restart and only acknowledges on explicit action", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "juunibi-outbox-"));
    const file = path.join(dir, "organizer.json");
    let now = Date.parse("2026-11-01T12:00:00.000Z");
    try {
      const first = new Organizer(file, () => now);
      await first.load();
      const reminder = await first.addReminder("delivery verification", new Date(now + 1000).toISOString());
      now += 2000;
      await first.tick();
      expect(first.deliverySnapshot().some(x => x.reminderId === reminder.id)).toBe(true);
      await first.flush();
      const second = new Organizer(file, () => now);
      await second.load();
      const restored = second.deliverySnapshot().find(x => x.reminderId === reminder.id);
      expect(restored?.state).toBe("pending");
      expect(await second.acknowledgeDelivery(reminder.id)).toEqual({ acknowledged: true });
      await second.flush();
      const third = new Organizer(file, () => now);
      await third.load();
      expect(third.deliverySnapshot().find(x => x.reminderId === reminder.id)?.state).toBe("acknowledged");
      await third.flush();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
