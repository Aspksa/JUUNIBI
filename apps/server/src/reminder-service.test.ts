import { describe, expect, it, vi } from "vitest";
import type { Automation, Note, Reminder, Repeat } from "./organizer";
import { DEFAULT_AUTOMATION } from "./organizer";
import { ReminderService } from "./reminder-service";

// Calendar scenarios use local wall-clock time in every host timezone.
function make(start = Date.parse("2026-10-09T08:00:00Z")) {
  let now = start;
  let reminders: Reminder[] = [];
  const notes: Note[] = [];
  let automation: Automation = { ...DEFAULT_AUTOMATION, rules: [] };
  const save = vi.fn(async () => {});

  const service = new ReminderService({
    getReminders: () => reminders,
    replaceReminders: (next) => { reminders = next; },
    getNotes: () => notes,
    getAutomation: () => automation,
    save,
    now: () => now,
    workday: (date) => date.getDay() !== 0 && date.getDay() !== 6,
    alignStart: (at, repeat, workday) => {
      if (repeat !== "weekdays") return at;
      const d = new Date(at);
      while (!workday(d)) d.setDate(d.getDate() + 1);
      return d.getTime();
    },
    nextOccurrence: (at: number, repeat: Repeat, after: number) => {
      const d = new Date(at);
      do d.setDate(d.getDate() + (repeat === "weekly" ? 7 : repeat === "every3days" ? 3 : 1));
      while (d.getTime() <= after);
      return d.getTime();
    },
    inQuiet: (time, from, to) => {
      const d = new Date(time);
      const mins = d.getHours() * 60 + d.getMinutes();
      const [fh, fm] = from.split(":").map(Number);
      const [th, tm] = to.split(":").map(Number);
      const f = fh! * 60 + fm!, t = th! * 60 + tm!;
      return f < t ? mins >= f && mins < t : mins >= f || mins < t;
    },
  });

  return {
    service,
    notes,
    get reminders() { return reminders; },
    setNow(value: number) { now = value; },
    setAutomation(patch: Partial<Automation>) { automation = { ...automation, ...patch }; },
    save,
  };
}

describe("ReminderService", () => {
  it("creates, edits, sorts and removes reminders", async () => {
    const x = make();
    const later = await x.service.add("Позже", "2026-10-10T12:00:00Z");
    const earlier = await x.service.add("Раньше", "2026-10-10T09:00:00Z");
    expect(x.service.list().map((item) => item.id)).toEqual([earlier.id, later.id]);

    const edited = await x.service.edit(later.id, { text: "Новый текст", repeat: "daily" });
    expect(edited).toMatchObject({ text: "Новый текст", repeat: "daily" });

    await x.service.remove(earlier.id);
    expect(x.service.list()).toHaveLength(1);
  });

  it("fires a one-off reminder once and supports snooze/dismiss", async () => {
    const x = make();
    const reminder = await x.service.add("Позвонить", "2026-10-09T09:00:00Z");
    x.setNow(Date.parse("2026-10-09T09:01:00Z"));

    expect(x.service.processDue().fired).toHaveLength(1);
    expect(x.service.processDue().fired).toHaveLength(0);

    const snoozed = await x.service.snooze(reminder.id, 15);
    expect(snoozed.status).toBe("scheduled");
    expect(Date.parse(snoozed.at)).toBe(Date.parse("2026-10-09T09:16:00Z"));

    x.setNow(Date.parse("2026-10-09T09:17:00Z"));
    expect(x.service.processDue().fired).toHaveLength(1);
    expect((await x.service.dismiss(reminder.id)).status).toBe("done");
  });

  it("fires repeating reminders as one-off copies and advances the series", async () => {
    const x = make();
    const series = await x.service.add("Вода", "2026-10-09T09:00:00Z", "daily");
    x.setNow(Date.parse("2026-10-09T10:00:00Z"));

    const first = x.service.processDue();
    expect(first.fired).toHaveLength(1);
    expect(first.fired[0]).toMatchObject({ seriesId: series.id, status: "due" });
    expect(x.service.list().find((item) => item.id === series.id)?.at).toBe("2026-10-10T09:00:00.000Z");
  });

  it("holds automatic reminders during quiet hours but not owner reminders", async () => {
    const x = make(Date.parse("2026-10-09T22:00:00"));
    x.setAutomation({ quiet: true, quietFrom: "23:00", quietTo: "08:00" });
    const automatic = await x.service.add("Авто", "2026-10-09T23:30:00");
    x.reminders.find((item) => item.id === automatic.id)!.source = "task-1";
    await x.service.add("Своё", "2026-10-09T23:30:00");
    x.setNow(Date.parse("2026-10-09T23:45:00"));

    expect(x.service.processDue().fired.map((item) => item.text)).toEqual(["Своё"]);

    x.setNow(Date.parse("2026-10-10T08:01:00"));
    const released = x.service.processDue();
    expect(released.fired.map((item) => item.text)).toEqual(["Авто"]);
    expect(released.releasedFromQuiet).toBe(1);
  });

  it("drops obsolete rule reminders for completed source tasks", async () => {
    const x = make();
    x.notes.push({
      id: "task",
      kind: "todo",
      text: "Готово",
      done: true,
      createdAt: "2026-10-09T08:00:00Z",
    });
    const reminder = await x.service.add("Rule", "2026-10-09T09:00:00Z");
    Object.assign(x.reminders.find((item) => item.id === reminder.id)!, { source: "task", rule: "r1" });
    x.setNow(Date.parse("2026-10-09T10:00:00Z"));

    const result = x.service.processDue();
    expect(result.fired).toEqual([]);
    expect(result.changed).toBe(true);
    expect(x.reminders.find((item) => item.id === reminder.id)?.status).toBe("done");
  });
});
