import { describe, expect, it } from "vitest";
import type { BrainPlan, MemoryItem, Note, QualityReport, Reminder } from "../src/api";
import { TILE_ORDER, buildBrainTiles, isTileId, plural, whenShort, type BrainData } from "../src/pages/brain-model";

const mem = (status: "active" | "pending"): MemoryItem => ({ id: Math.random().toString(), kind: "fact", text: "x", status, score: 0 });
const plan = (status: BrainPlan["status"]): BrainPlan => ({ id: "p", goal: "g", createdAt: "", status, steps: [] });
const full: BrainData = { memory: [mem("active"), mem("active"), mem("pending")], plans: [plan("running"), plan("planned")], learning: { enabled: true, used: 3, limit: 50 }, knowledge: 4, graph: { nodes: 5, edges: 7 }, gaps: 2 };
const by = (d: BrainData) => Object.fromEntries(buildBrainTiles(d).map((t) => [t.id, t]));

describe("плитки «Мозга»", () => {
  it("есть все плитки в заданном порядке, и память — первая", () => {
    expect(buildBrainTiles(full).map((t) => t.id)).toEqual(TILE_ORDER);
    expect(TILE_ORDER[0]).toBe("memory");
  });
  it("память: активные записи в значении, ожидающие — в значке и тревожном цвете", () => {
    expect(by(full).memory).toMatchObject({ value: "2", tone: "warn", badge: "1 ждут" });
    expect(by({ ...full, memory: [mem("active")] }).memory).toMatchObject({ value: "1", tone: "ok" });
    expect(by({ ...full, memory: [mem("active")] }).memory!.badge).toBeUndefined();
  });
  it("планы, обучение, знания, связи и пробелы показывают свои числа", () => {
    const t = by(full);
    expect(t.plans).toMatchObject({ value: "2", sub: "1 в работе", tone: "ok" });
    expect(t.learning).toMatchObject({ value: "3/50", tone: "ok" });
    expect(t.knowledge!.value).toBe("4");
    expect(t.graph).toMatchObject({ value: "7", sub: "5 узлов в графе" });
    expect(t.gaps).toMatchObject({ value: "2", tone: "warn" });
  });
  it("приостановленное обучение и пустые списки выглядят спокойно", () => {
    const t = by({ ...full, learning: { enabled: false, used: 0, limit: 50 }, plans: [], gaps: 0 });
    expect(t.learning).toMatchObject({ sub: "приостановлено", tone: "off" });
    expect(t.plans).toMatchObject({ value: "0", sub: "пока нет", tone: "off" });
    expect(t.gaps).toMatchObject({ sub: "пробелов нет", tone: "ok" });
  });
  it("если модуль «Мозг» недоступен, его плитки серые с прочерком, а память работает", () => {
    const t = by({ memory: [mem("active")], plans: null, learning: null, knowledge: null, graph: null, gaps: null });
    for (const id of ["plans", "learning", "knowledge", "graph", "gaps"] as const) expect(t[id]).toMatchObject({ value: "—", sub: "недоступно", tone: "off" });
    expect(t.memory).toMatchObject({ value: "1", tone: "ok" });
  });
  it("склонение", () => {
    const f: [string, string, string] = ["узел", "узла", "узлов"];
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => plural(n, f))).toEqual(["узел", "узла", "узла", "узлов", "узлов", "узлов", "узлов", "узел", "узла", "узлов", "узел", "узлов"]);
  });
  it("isTileId принимает только известные плитки", () => {
    expect(isTileId("memory")).toBe(true);
    expect([isTileId("x"), isTileId(undefined), isTileId(5)]).toEqual([false, false, false]);
  });
});

describe("плитки «Заметки», «Напоминания», «Качество»", () => {
  const note = (kind: "note" | "todo", done = false): Note => ({ id: Math.random().toString(), kind, text: "x", done, createdAt: "" });
  const rem = (status: Reminder["status"], at: string): Reminder => ({ id: Math.random().toString(), text: "x", at, createdAt: "", status });
  const q = (satisfaction: number | null, rated: number): QualityReport => ({ totals: { turns: rated, rated, up: 0, down: 0, unrated: 0, satisfaction }, byDay: [], byTool: [], worst: [], troubleWords: [], datasetReady: 0 });
  it("заметки считают только открытые дела", () => {
    const t = by({ ...full, organizer: { notes: [note("todo"), note("todo", true), note("note")], reminders: [] } });
    expect(t.notes).toMatchObject({ value: "1", sub: "дело в списке", tone: "ok" });
    expect(by({ ...full, organizer: { notes: [note("note")], reminders: [] } }).notes).toMatchObject({ value: "0", sub: "дел нет", tone: "off" });
    expect(by({ ...full, organizer: { notes: [], reminders: [] } }).notes).toMatchObject({ sub: "пока пусто" });
    expect(by({ ...full, organizer: null }).notes).toMatchObject({ value: "—", sub: "недоступно" });
  });
  it("напоминания: сработавшие в тревожном цвете с значком, иначе ближайшее", () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const t = by({ ...full, organizer: { notes: [], reminders: [rem("due", "2026-01-01T00:00:00Z"), rem("scheduled", future), rem("done", "2026-01-01T00:00:00Z")] } });
    expect(t.reminders).toMatchObject({ value: "2", tone: "warn", badge: "1 сейчас", sub: "сработали: 1" });
    const calm = by({ ...full, organizer: { notes: [], reminders: [rem("scheduled", future)] } }).reminders!;
    expect(calm).toMatchObject({ value: "1", tone: "ok" });
    expect(calm.badge).toBeUndefined();
    expect(by({ ...full, organizer: { notes: [], reminders: [] } }).reminders).toMatchObject({ value: "0", sub: "нет", tone: "off" });
  });
  it("качество: доля довольных, результат проверки и тревога при низкой доле", () => {
    expect(by({ ...full, quality: q(80, 10), evalLast: { passed: 11, total: 12 } }).quality).toMatchObject({ value: "80%", sub: "проверка 11 из 12", tone: "ok" });
    expect(by({ ...full, quality: q(40, 5) }).quality).toMatchObject({ value: "40%", sub: "5 оценок", tone: "warn" });
    expect(by({ ...full, quality: q(null, 0) }).quality).toMatchObject({ value: "—", sub: "нет оценок", tone: "off" });
    expect(by({ ...full, quality: null }).quality).toMatchObject({ value: "—", sub: "недоступно" });
  });
  it("whenShort: сегодня, завтра, дальше — дата", () => {
    const now = new Date(2026, 9, 9, 8, 0);
    expect(whenShort(new Date(2026, 9, 9, 18, 30).toISOString(), now)).toBe("сегодня 18:30");
    expect(whenShort(new Date(2026, 9, 10, 9, 0).toISOString(), now)).toBe("завтра 09:00");
    expect(whenShort(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toMatch(/20 окт/);
    expect(whenShort("нет", now)).toBe("нет");
  });
});
