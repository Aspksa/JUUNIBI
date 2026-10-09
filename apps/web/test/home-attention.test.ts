import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/state";
import { buildAttention } from "../src/pages/home";

const base = { status: { assistant: true }, memory: [], modules: [], approvals: [], update: null, chatOpen: false } as unknown as AppState;
const state = (o: Partial<AppState>): AppState => ({ ...base, ...o } as AppState);
const deps = () => ({ go: vi.fn(), openChat: vi.fn() });
const ids = (s: AppState) => buildAttention(s, deps()).map((a) => a.id);
const upd = (o: object) => ({ phase: "idle", localVersion: "a".repeat(40), latest: { sha: "b".repeat(40), version: "bbbbbbbb", description: "", date: "" }, ...o }) as AppState["update"];

describe("Требует внимания: каждый повод ровно один раз", () => {
  it("пусто, когда всё в порядке", () => { expect(ids(state({}))).toEqual([]); });
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
  it("все id в одном списке уникальны", () => {
    const s = state({ status: { assistant: false } as AppState["status"], update: upd({}), approvals: [{ id: "1" }] as never, memory: [{ status: "pending" }] as never,
      modules: [{ name: "a", deps: [], status: "failed" }] as never });
    const list = ids(s);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toEqual(["key", "approvals", "update", "memory", "modules"]);
  });
});
