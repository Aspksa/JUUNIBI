import { describe, expect, it } from "vitest";
import type { Note } from "../src/api";
import { parseQuick } from "../src/pages/quick-entry";
import { areaOf, boardColumns, buildTasks, dayCapacity, meetingSpan, preferredArea, projectList, workWeek } from "../src/pages/tasks-model";
import { filterItems, generatePassword, passwordStrength, safeUrl } from "../src/pages/vault-model";

// Пятница, 9 октября 2026, 14:00 по местному времени
const now = new Date(2026, 9, 9, 14, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const todo = (id: string, o: Partial<Note> = {}): Note => ({ id, kind: "todo", text: id, done: false, createdAt: "2026-10-01T10:00:00.000Z", ...o });

describe("быстрый ввод: работа и встречи", () => {
  it("«по работе» и «личное» задают сферу и уходят из текста", () => {
    expect(parseQuick("по работе отправить отчёт", now)).toMatchObject({ kind: "todo", text: "отправить отчёт", area: "work" });
    expect(parseQuick("личное: купить подарок", now)).toMatchObject({ text: "купить подарок", area: "personal" });
  });
  it("начало и конец — это встреча-дело, а не напоминание", () => {
    expect(parseQuick("завтра с 10 до 11:30 созвон с клиентом", now)).toMatchObject({ kind: "todo", text: "созвон с клиентом", at: at(10, 10), meeting: true, minutes: 90 });
    expect(parseQuick("планёрка в 15 на полчаса", now)).toMatchObject({ kind: "todo", at: at(9, 15), meeting: true, minutes: 30 });
    expect(parseQuick("10:00-10:45 разбор почты", now)).toMatchObject({ kind: "todo", text: "разбор почты", meeting: true, minutes: 45 });
    // a time without an end stays a reminder, and «1-2 кг» is not a time
    expect(parseQuick("созвон в 7 вечера", now)).toMatchObject({ kind: "reminder" });
    expect(parseQuick("купить 1-2 кг яблок", now)).toEqual({ kind: "todo", text: "купить 1-2 кг яблок" });
    // a length without a start is only how long it takes
    expect(parseQuick("написать письмо на 20 минут", now)).toEqual({ kind: "todo", text: "написать письмо", minutes: 20 });
  });
  it("«по пятницам» повторяет каждую неделю в этот день", () => {
    expect(parseQuick("отчёт по пятницам в 17:00 #работа", now)).toMatchObject({ kind: "reminder", repeat: "weekly", at: at(9, 17) });
    expect(parseQuick("созвон по понедельникам с 10 до 10:30 #работа", now)).toMatchObject({ kind: "todo", repeat: "weekly", at: at(12, 10), meeting: true, minutes: 30, project: "работа" });
  });
});

describe("«Дела»: работа и личное", () => {
  const projects = [{ name: "Cloud.ru", area: "work" as const, color: "blue" }];
  it("сфера дела: своя, проекта, или «работа» по имени проекта", () => {
    expect(areaOf(todo("a", { project: "cloud.ru" }), projects)).toBe("work");
    expect(areaOf(todo("a", { project: "Работа" }))).toBe("work");
    expect(areaOf(todo("a"))).toBe("personal");
  });
  it("переключатель «Работа» оставляет только рабочие дела, «Личное» — остальное с напоминаниями", () => {
    const org = { notes: [todo("w", { area: "work" }), todo("p"), { ...todo("n"), kind: "note" as const }], reminders: [{ id: "r", text: "r", at: at(9, 18), createdAt: at(1, 1), status: "scheduled" as const }] };
    const work = buildTasks(org, "all", "", now, { area: "work" });
    expect(work.someday.map((n) => n.id)).toEqual(["w"]);
    expect(work.notes).toEqual([]);
    expect(work.today).toEqual([]);
    const mine = buildTasks(org, "all", "", now, { area: "personal" });
    expect(mine.someday.map((n) => n.id)).toEqual(["p"]);
    expect(mine.notes.map((n) => n.id)).toEqual(["n"]);
    expect(mine.today.map((x) => x.type)).toEqual(["reminder"]);
  });
  it("в рабочее время рабочие дела выше, вечером — личные", () => {
    const notes = [todo("p", { createdAt: "2026-10-01T09:00:00.000Z" }), todo("w", { area: "work", createdAt: "2026-10-01T10:00:00.000Z" })];
    expect(buildTasks({ notes, reminders: [] }, "all", "", now, { prefer: "work" }).someday.map((n) => n.id)).toEqual(["w", "p"]);
    expect(buildTasks({ notes, reminders: [] }, "all", "", now, { prefer: "personal" }).someday.map((n) => n.id)).toEqual(["p", "w"]);
    expect(preferredArea(new Date(2026, 9, 9, 10), { workFrom: "09:00", workTo: "18:00", workday: true })).toBe("work");
    expect(preferredArea(new Date(2026, 9, 9, 19), { workFrom: "09:00", workTo: "18:00", workday: true })).toBe("personal");
    expect(preferredArea(new Date(2026, 9, 10, 10), { workFrom: "09:00", workTo: "18:00", workday: false })).toBe("personal");
  });
  it("доска раскладывает дела по статусам и показывает сделанное за неделю", () => {
    const cols = boardColumns([todo("a"), todo("b", { status: "doing" }), todo("c", { status: "waiting", waitingFor: "Иван" }), todo("d", { done: true, completedAt: at(8, 12) }), todo("old", { done: true, completedAt: at(1, 12) })], now);
    expect(Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.map((n) => n.id)]))).toEqual({ todo: ["a"], doing: ["b"], waiting: ["c"], done: ["d"] });
  });
  it("часы рабочей недели и время встречи", () => {
    const notes = [todo("a", { area: "work", dueAt: at(6, 10), estimateMinutes: 120, done: true }), todo("b", { area: "work", dueAt: at(8, 10) }), todo("c", { dueAt: at(8, 10), estimateMinutes: 60 })];
    expect(workWeek(notes, [], now)).toEqual({ planned: 150, done: 120, count: 2 });
    expect(meetingSpan(todo("m", { dueAt: at(9, 10), estimateMinutes: 90, meeting: true }))).toBe("10:00–11:30");
  });
  it("проекты: прогресс, цвет, срок; в отпуске половина часов", () => {
    const list = projectList([todo("a", { project: "Cloud.ru" }), todo("b", { project: "Cloud.ru", done: true }), todo("c", { project: "дом", done: true })], [{ name: "cloud.ru", color: "blue", dueAt: "2026-12-01", area: "work" }], () => undefined);
    expect(list).toEqual([{ id: "Cloud.ru", label: "Cloud.ru", open: 1, done: 1, total: 2, goal: false, color: "blue", dueAt: "2026-12-01", area: "work" }]);
    expect(dayCapacity("2026-10-13", 8, [{ id: "v", from: "2026-10-12", to: "2026-10-16", kind: "vacation" }])).toBe(240);
    expect(dayCapacity("2026-10-13", 8)).toBe(480);
  });
});

describe("«Пароли»: помощники", () => {
  it("придумывает пароль нужной длины со всеми видами символов", () => {
    for (let i = 0; i < 20; i++) {
      const p = generatePassword(16);
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/\d/); expect(p).toMatch(/[^a-zA-Z0-9]/);
      expect(p).not.toMatch(/[lO01]/);
    }
    expect(generatePassword(3)).toHaveLength(8);
  });
  it("оценивает надёжность", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("1234567").score).toBe(0);
    expect(passwordStrength("qwerty123").score).toBe(0);
    expect(passwordStrength("Kitsune2026x").score).toBe(2);
    expect(passwordStrength("K!tsune-2026-Forest").label).toBe("Сильный");
  });
  it("открывает только http(s) ссылки", () => {
    expect(safeUrl("gosuslugi.ru")).toBe("https://gosuslugi.ru/");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });
  it("ищет по названию и логину, но не по паролю", () => {
    const items = [{ id: "1", title: "Почта", login: "fox", password: "секрет", createdAt: "", updatedAt: "" }];
    expect(filterItems(items, "fox")).toHaveLength(1);
    expect(filterItems(items, "секрет")).toHaveLength(0);
  });
});
