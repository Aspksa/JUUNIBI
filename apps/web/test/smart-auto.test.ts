import { describe, expect, it } from "vitest";
import { findPromise } from "../src/pages/quick-entry";
import { heroFallback, stuckTodos } from "../src/pages/tasks-model";

const now = new Date(2026, 9, 12, 14, 0); // понедельник

describe("обещания из чата", () => {
  it("находит «надо» с датой и убирает служебные слова", () => {
    const p = findPromise("Привет! Завтра надо позвонить маме. Как дела?", now)!;
    expect(p.kind).toBe("todo");
    expect(p.text).toBe("Позвонить маме");
    expect(new Date(p.at!).getDate()).toBe(13);
    expect(findPromise("мне нужно в пятницу в 10 сдать отчёт", now)!.text).toBe("Сдать отчёт");
    expect(findPromise("не забыть 15 октября оплатить интернет", now)!.text).toBe("Оплатить интернет");
  });
  it("пропускает вопросы, просьбы к ассистенту и фразы без даты", () => {
    expect(findPromise("Надо ли завтра идти?", now)).toBeNull();
    expect(findPromise("Напомни завтра в 10 позвонить", now)).toBeNull();
    expect(findPromise("Надо бы как-нибудь прибраться", now)).toBeNull();
    expect(findPromise("Завтра будет дождь", now)).toBeNull();
  });
});

describe("сводка по времени суток", () => {
  const base = { brief: true, briefTime: "09:00", evening: true, eveningTime: "21:00", dayOff: false, done: 2, left: 1, tomorrow: 3, tomorrowFirst: "Созвон" };
  it("утром ждёт сводку, днём предлагает составить, вечером подводит итог", () => {
    expect(heroFallback({ ...base, now: new Date(2026, 9, 12, 8) }).text).toMatch(/появится в 09:00/);
    expect(heroFallback({ ...base, now: new Date(2026, 9, 12, 12) }).text).toMatch(/ещё не составляли/);
    const e = heroFallback({ ...base, now: new Date(2026, 9, 10, 20) });
    expect(e.evening).toBe(true);
    expect(e.text).toBe("Сегодня сделано: 2, не успели: 1. Завтра дел: 3, первое — Созвон. Остаток можно перенести на завтра в «Итоге дня».");
    expect(heroFallback({ ...base, dayOff: true, done: 0, left: 0, tomorrow: 0, now: new Date(2026, 9, 10, 19) }).text).toBe("Спокойный день без дел. На завтра дел пока нет.");
  });
  it("застрявшие дела", () => {
    const n = (rolled?: number) => ({ id: String(rolled), kind: "todo" as const, text: "x", done: false, createdAt: "", ...(rolled ? { rolled } : {}) });
    expect(stuckTodos([n(), n(2), n(3), n(5)], 3).map((x) => x.rolled)).toEqual([3, 5]);
    expect(stuckTodos([n(5)], 0)).toEqual([]);
  });
});
