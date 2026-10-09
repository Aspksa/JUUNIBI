import { describe, expect, it } from "vitest";
import type { Turn } from "@juunibi/assistant";
import { repeatedRequests } from "./suggestions";

const NOW = Date.parse("2026-10-09T12:00:00");
let n = 0;
const turn = (user: string, daysAgo = 1): Turn => ({ id: "t" + n++, session: "s", user, reply: "ок", tools: [], memoryIds: [], at: NOW - daysAgo * 86_400_000 });

describe("повторяющиеся просьбы", () => {
  it("предлагает сохранить то, что просили три раза и больше, с учётом мелких различий", () => {
    const r = repeatedRequests([turn("Подведи итоги дня"), turn("подведи итоги дня!"), turn("Подведи, пожалуйста, итоги дня"), turn("Привет"), turn("Погода завтра")], [], NOW);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ count: 3, name: "подведи" });
    expect(r[0]!.text).toContain("итоги дня");
  });
  it("двух раз мало; приветствия, команды и старые просьбы не считаются", () => {
    expect(repeatedRequests([turn("Подведи итоги дня"), turn("Подведи итоги дня")], [], NOW)).toEqual([]);
    expect(repeatedRequests([turn("Привет"), turn("Привет"), turn("Привет")], [], NOW)).toEqual([]);
    expect(repeatedRequests([turn("/сводка день"), turn("/сводка день"), turn("/сводка день")], [], NOW)).toEqual([]);
    expect(repeatedRequests([turn("Подведи итоги дня", 40), turn("Подведи итоги дня", 41), turn("Подведи итоги дня", 42)], [], NOW)).toEqual([]);
  });
  it("уже сохранённое не предлагается повторно, имя не совпадает со встроенными и сохранёнными", () => {
    const t = [turn("Составь план недели"), turn("Составь план недели"), turn("Составь план недели")];
    expect(repeatedRequests(t, [{ name: "неделя", text: "Составь план недели" }], NOW)).toEqual([]);
    const withTaken = repeatedRequests(t, [{ name: "составь", text: "другое" }], NOW);
    expect(withTaken[0]!.name).not.toBe("составь");
    const builtin = repeatedRequests([turn("Память проверить сейчас"), turn("Память проверить сейчас"), turn("Память проверить сейчас")], [], NOW);
    expect(["память", "memory"]).not.toContain(builtin[0]!.name);
  });
  it("не больше трёх предложений, самые частые первыми", () => {
    const mk = (text: string, k: number) => Array.from({ length: k }, () => turn(text));
    const r = repeatedRequests([...mk("Первая просьба номер один", 3), ...mk("Вторая просьба номер два", 5), ...mk("Третья просьба номер три", 4), ...mk("Четвёртая просьба номер четыре", 3)], [], NOW);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.count)).toEqual([5, 4, 3]);
  });
});
