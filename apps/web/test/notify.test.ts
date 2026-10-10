import { describe, expect, it } from "vitest";
import { unannounced } from "../src/notify";
import { defaultReminderTime } from "../src/pages/tasks-model";

describe("напоминания в интерфейсе", () => {
  it("unannounced оставляет только ещё не показанные", () => {
    expect(unannounced([{ id: "a" }, { id: "b" }, { id: "c" }], new Set(["b"])).map((x) => x.id)).toEqual(["a", "c"]);
    expect(unannounced([], new Set(["a"]))).toEqual([]);
  });
  it("время по умолчанию — завтра в 09:00 по местному времени", () => {
    expect(defaultReminderTime(new Date(2026, 9, 9, 22, 15))).toBe("2026-10-10T09:00");
    expect(defaultReminderTime(new Date(2026, 11, 31, 8, 0))).toBe("2027-01-01T09:00");
  });
});
