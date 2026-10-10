import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/state";
import { briefItems, buildAttention } from "../src/pages/home";

const base = { status: { assistant: true }, memory: [], modules: [], approvals: [], update: null, chatOpen: false } as unknown as AppState;
const state = (o: Partial<AppState>): AppState => ({ ...base, ...o } as AppState);
const deps = () => ({ go: vi.fn(), openChat: vi.fn() });
const ids = (s: AppState) => buildAttention(s, deps()).map((a) => a.id);
const upd = (o: object) => ({ phase: "idle", localVersion: "a".repeat(40), latest: { sha: "b".repeat(40), version: "bbbbbbbb", description: "", date: "" }, ...o }) as AppState["update"];

describe("Требует внимания: каждый повод ровно один раз", () => {
  it("пусто, когда всё в порядке", () => { expect(ids(state({}))).toEqual([]); });
  it("обновление: текст зависит от готовности, отката и результата CI, строка всегда одна", () => {
    const text = (o: object) => buildAttention(state({ update: upd(o) }), deps()).map((a) => a.text);
    expect(text({ phase: "ready" })[0]).toMatch(/можно установить/);
    expect(text({ rollbackPending: true })[0]).toMatch(/откат/);
    expect(text({ blocked: "CI ещё идёт" })[0]).toMatch(/ещё не пройдены/);
    expect(text({})[0]).toMatch(/Доступна новая версия/);
  });
  it("нет ключа — одна строка и переход в настройки", () => {
    const d = deps();
    const items = buildAttention(state({ status: { assistant: false } as AppState["status"] }), d);
    expect(items.map((a) => a.id)).toEqual(["key"]);
    items[0]!.run();
    expect(d.go).toHaveBeenCalledWith("settings");
  });
  it("пока статус неизвестен, про ключ не говорим", () => { expect(ids(state({ status: null }))).toEqual([]); });
  it("новая версия и готовое обновление не дублируются", () => {
    expect(ids(state({ update: upd({}) }))).toEqual(["update"]);
    expect(ids(state({ update: upd({ phase: "ready" }) }))).toEqual(["update"]);
    expect(ids(state({ update: upd({ localVersion: "b".repeat(40) }) }))).toEqual([]);
    expect(ids(state({ update: upd({ localVersion: "не определена" }) }))).toEqual([]);
  });
  it("подтверждения действий скрыты, пока чат открыт (они уже в переписке)", () => {
    const approvals = [{ id: "1" }] as unknown as AppState["approvals"];
    expect(ids(state({ approvals }))).toEqual(["approvals"]);
    expect(ids(state({ approvals, chatOpen: true }))).toEqual([]);
    const d = deps();
    buildAttention(state({ approvals }), d)[0]!.run();
    expect(d.openChat).toHaveBeenCalled();
  });
  it("память на подтверждение и модули со сбоем", () => {
    const memory = [{ status: "pending" }, { status: "active" }, { status: "pending" }] as unknown as AppState["memory"];
    const modules = [{ name: "a", deps: [], status: "failed" }, { name: "b", deps: [], status: "started" }] as unknown as AppState["modules"];
    const items = buildAttention(state({ memory, modules }), deps());
    expect(items.map((a) => a.id)).toEqual(["memory", "modules"]);
    expect(items[0]!.text).toContain("2");
  });
  it("остановленный модуль не считается сбоем", () => {
    const modules = [{ name: "a", deps: [], status: "stopped" }] as unknown as AppState["modules"];
    expect(ids(state({ modules }))).toEqual([]);
  });
  it("сработавшие напоминания: одна строка с текстом, при нескольких — со счётом", () => {
    const brief = (n: number) => ({ now: "", due: Array.from({ length: n }, (_, i) => ({ id: "r" + i, text: "Позвонить маме", at: "" })), today: [], openTodos: { count: 0, first: [] }, plansRunning: 0, memoryPending: 0, modulesFailed: [], updateAvailable: false, attention: n }) as AppState["brief"];
    const one = buildAttention(state({ brief: brief(1) }), deps());
    expect(one.map((a) => a.id)).toEqual(["reminder"]);
    expect(one[0]!.text).toContain("Позвонить маме");
    expect(buildAttention(state({ brief: brief(3) }), deps())[0]!.text).toContain("3");
    const d = deps(); one[0]!.run();
    expect(ids(state({ brief: brief(0) }))).toEqual([]);
    void d;
  });
  it("повторяющаяся просьба: предложение сохранить, с кнопкой «Не надо»; без обработчиков не показывается", () => {
    const suggestion = { text: "Подведи итоги дня", count: 3, name: "подведи" };
    const saved = vi.fn(), dismissed = vi.fn();
    const items = buildAttention(state({ repeatSuggestions: [suggestion] }), { ...deps(), saveQuickCommand: saved, dismissSuggestion: dismissed });
    expect(items.map((a) => a.id)).toEqual(["suggest"]);
    expect(items[0]!.text).toContain("/подведи");
    items[0]!.run(); items[0]!.secondary!.run();
    expect(saved).toHaveBeenCalledWith("подведи", "Подведи итоги дня");
    expect(dismissed).toHaveBeenCalledWith("подведи");
    expect(ids(state({ repeatSuggestions: [suggestion] }))).toEqual([]);
  });
  it("все id в одном списке уникальны", () => {
    const s = state({ status: { assistant: false } as AppState["status"], update: upd({}), approvals: [{ id: "1" }] as never, memory: [{ status: "pending" }] as never,
      modules: [{ name: "a", deps: [], status: "failed" }] as never });
    const list = ids(s);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toEqual(["key", "approvals", "update", "memory", "modules"]);
  });
});

describe("карточка «Сегодня»", () => {
  const brief = (o: Partial<NonNullable<AppState["brief"]>> = {}) => ({ now: "", due: [], today: [], openTodos: { count: 0, first: [] }, plansRunning: 0, memoryPending: 0, modulesFailed: [], updateAvailable: false, attention: 0, ...o }) as NonNullable<AppState["brief"]>;
  it("порядок: сработавшее, запланированное на сегодня, дела; не больше шести", () => {
    const b = brief({ due: [{ id: "1", text: "утро", at: "" }], today: [{ id: "2", text: "вечер", at: "2026-10-09T18:00:00" }], openTodos: { count: 9, first: Array.from({ length: 5 }, (_, i) => ({ id: "t" + i, text: "дело " + i })) } });
    const items = briefItems(b);
    expect(items.map((i) => i.kind)).toEqual(["due", "today", "todo", "todo", "todo", "todo"]);
    expect(items[0]!.when).toBe("сработало");
    expect(items[1]!.when).toMatch(/18:00/);
    expect(briefItems(b, 2)).toHaveLength(2);
  });
  it("пустой день — пустой список", () => { expect(briefItems(brief())).toEqual([]); });
});
