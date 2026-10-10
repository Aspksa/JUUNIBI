import { describe, expect, it } from "vitest";
import { endOfDay, parseQuick } from "../src/pages/quick-entry";

// Пятница, 9 октября 2026, 14:00 по местному времени
const now = new Date(2026, 9, 9, 14, 0);
const at = (d: number, h: number, m = 0, mon = 9, y = 2026) => new Date(y, mon, d, h, m).toISOString();

describe("быстрый ввод", () => {
  it("простое дело без даты", () => {
    expect(parseQuick("Купить хлеб", now)).toEqual({ kind: "todo", text: "Купить хлеб" });
  });
  it("завтра в 10 — напоминание", () => {
    expect(parseQuick("завтра в 10 позвонить маме", now)).toEqual({ kind: "reminder", text: "позвонить маме", at: at(10, 10) });
    expect(parseQuick("Позвонить маме завтра в 10:30", now)).toMatchObject({ kind: "reminder", text: "Позвонить маме", at: at(10, 10, 30) });
    expect(parseQuick("созвон в 7 вечера", now)).toMatchObject({ kind: "reminder", text: "созвон", at: at(9, 19) });
  });
  it("время, которое уже прошло сегодня, — это завтра", () => {
    expect(parseQuick("в 9 зарядка", now).at).toBe(at(10, 9));
    expect(parseQuick("в 18:15 спорт", now).at).toBe(at(9, 18, 15));
  });
  it("дата без времени — дело со сроком", () => {
    expect(parseQuick("сдать отчёт в понедельник", now)).toEqual({ kind: "todo", text: "сдать отчёт", at: at(12, 9), dateOnly: true });
    expect(parseQuick("оплатить интернет 15 октября", now)).toMatchObject({ kind: "todo", text: "оплатить интернет", at: at(15, 9), dateOnly: true });
    expect(parseQuick("поздравить 5 января", now)).toMatchObject({ at: at(5, 9, 0, 0, 2027) });
    expect(parseQuick("продлить страховку 20.11", now)).toMatchObject({ at: at(20, 9, 0, 10) });
    expect(parseQuick("купить подарок послезавтра", now)).toMatchObject({ kind: "todo", text: "купить подарок", at: at(11, 9) });
  });
  it("через N минут/часов/дней", () => {
    expect(parseQuick("через 15 минут выключить духовку", now)).toMatchObject({ kind: "reminder", text: "выключить духовку", at: new Date(now.getTime() + 15 * 60_000).toISOString() });
    expect(parseQuick("через час проверить почту", now).at).toBe(new Date(now.getTime() + 3_600_000).toISOString());
    expect(parseQuick("через полчаса чай", now).at).toBe(new Date(now.getTime() + 1_800_000).toISOString());
    expect(parseQuick("через 3 дня вернуть книгу", now)).toMatchObject({ kind: "todo", at: at(12, 9), dateOnly: true });
  });
  it("повторы", () => {
    expect(parseQuick("каждый день в 9 пить воду", now)).toEqual({ kind: "reminder", text: "пить воду", repeat: "daily", at: at(10, 9) });
    expect(parseQuick("по будням в 10 стендап", now)).toMatchObject({ repeat: "weekdays", at: at(10, 10), text: "стендап" });
    expect(parseQuick("каждый пн в 9 планёрка", now)).toMatchObject({ repeat: "weekly", at: at(12, 9), text: "планёрка" });
    expect(parseQuick("каждую пятницу в 18 отчёт", now)).toMatchObject({ repeat: "weekly", at: at(9, 18) });
    // a repeat without a time is a repeating to-do with a date; with a time or «напомни» it is a reminder
    expect(parseQuick("ежемесячно оплатить квартиру", now)).toEqual({ kind: "todo", text: "оплатить квартиру", repeat: "monthly", at: at(9, 9), dateOnly: true });
    expect(parseQuick("каждый месяц 25-го оплатить квартиру", now)).toEqual({ kind: "todo", text: "оплатить квартиру", repeat: "monthly", at: at(25, 9), dateOnly: true });
    expect(parseQuick("каждый месяц 5 числа сдать показания", now)).toMatchObject({ kind: "todo", repeat: "monthly", at: new Date(2026, 10, 5, 9).toISOString() });
    expect(parseQuick("каждый пн вынести мусор", now)).toMatchObject({ kind: "todo", repeat: "weekly", at: at(12, 9), dateOnly: true });
    expect(parseQuick("напомни ежемесячно оплатить квартиру", now)).toMatchObject({ kind: "reminder", repeat: "monthly" });
    expect(parseQuick("каждый год 5 марта день рождения мамы", now)).toMatchObject({ kind: "todo", repeat: "yearly", text: "день рождения мамы", at: new Date(2027, 2, 5, 9).toISOString() });
  });
  it("важность и проект", () => {
    expect(parseQuick("! дописать отчёт #работа", now)).toEqual({ kind: "todo", text: "дописать отчёт", priority: "high", project: "работа" });
    expect(parseQuick("срочно купить лекарства", now)).toMatchObject({ priority: "high", text: "купить лекарства" });
  });
  it("заметки и выбранный тип", () => {
    expect(parseQuick("Заметка: код домофона 1234", now)).toEqual({ kind: "note", text: "код домофона 1234" });
    expect(parseQuick("завтра в 10 код 1234", now, "note")).toEqual({ kind: "note", text: "завтра в 10 код 1234" });
    expect(parseQuick("завтра в 10 созвон", now, "todo")).toMatchObject({ kind: "todo", at: at(10, 10) });
    expect(parseQuick("напомни купить молоко", now)).toEqual({ kind: "reminder", text: "купить молоко" });
  });
  it("не ломает обычный текст", () => {
    expect(parseQuick("прочитать 2 главы", now)).toEqual({ kind: "todo", text: "прочитать 2 главы" });
    expect(parseQuick("завтра", now)).toMatchObject({ text: "завтра" });
    expect(parseQuick("купить мандарины", now).text).toBe("купить мандарины");
  });
  it("конец дня", () => {
    expect(endOfDay(at(12, 9))).toBe(at(12, 23, 59));
  });
});
