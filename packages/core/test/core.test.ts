import { describe, expect, it, vi } from "vitest";
import { EventBus, Kernel, Logger, Store, attempt, attemptAsync } from "../src";

const quiet = () => new Logger("t", "silent");

describe("Result", () => {
  it("captures sync and async errors", async () => {
    expect(attempt(() => 1)).toEqual({ ok: true, value: 1 });
    const r = attempt(() => { throw new Error("x"); });
    expect(r.ok).toBe(false);
    const a = await attemptAsync(async () => { throw "boom"; });
    expect(!a.ok && a.error.message).toBe("boom");
  });
});

describe("EventBus", () => {
  it("delivers, unsubscribes, once, and isolates handler errors", () => {
    const onError = vi.fn();
    const bus = new EventBus<{ a: number }>(onError);
    const got: number[] = [];
    bus.on("a", () => { throw new Error("bad"); });
    const off = bus.on("a", (n) => got.push(n));
    bus.once("a", (n) => got.push(n * 10));
    bus.emit("a", 1);
    bus.emit("a", 2);
    off();
    bus.emit("a", 3);
    expect(got).toEqual([1, 10, 2]);
    expect(onError).toHaveBeenCalledTimes(3);
  });
});

describe("Store", () => {
  it("updates immutably and skips no-op sets", () => {
    const s = new Store({ n: 0, m: 0 });
    const l = vi.fn();
    s.subscribe(l);
    const before = s.get();
    s.set({ n: 0 });
    expect(l).not.toHaveBeenCalled();
    s.set((x) => ({ n: x.n + 1 }));
    expect(l).toHaveBeenCalledTimes(1);
    expect(s.get()).not.toBe(before);
    expect(before.n).toBe(0);
  });
  it("select fires only on change", () => {
    const s = new Store({ n: 0, m: 0 });
    const l = vi.fn();
    s.select((x) => x.n, l);
    s.set({ m: 1 });
    s.set({ n: 5 });
    expect(l).toHaveBeenCalledOnce();
    expect(l).toHaveBeenCalledWith(5, 0);
  });
});

describe("Kernel", () => {
  it("starts in dependency order and stops in reverse", async () => {
    const log: string[] = [];
    const k = new Kernel(quiet());
    k.register({ name: "b", deps: ["a"], start: (c) => { log.push("b+"); c.onStop(() => void log.push("b-")); } });
    k.register({ name: "a", start: (c) => { log.push("a+"); c.onStop(() => void log.push("a-")); } });
    await k.start();
    await k.stop();
    expect(log).toEqual(["a+", "b+", "b-", "a-"]);
  });
  it("detects cycles and missing deps", () => {
    const k = new Kernel(quiet());
    k.register({ name: "a", deps: ["b"], start() {} }).register({ name: "b", deps: ["a"], start() {} });
    expect(() => k.order()).toThrow(/cycle/);
    const k2 = new Kernel(quiet());
    k2.register({ name: "a", deps: ["zzz"], start() {} });
    expect(() => k2.order()).toThrow(/Missing/);
  });
  it("isolates a failing plugin and skips its dependents", async () => {
    const k = new Kernel(quiet());
    const ran: string[] = [];
    const failed = vi.fn();
    k.bus.on("plugin:failed", failed);
    k.register({ name: "bad", start() { throw new Error("no"); } });
    k.register({ name: "child", deps: ["bad"], start() { ran.push("child"); } });
    k.register({ name: "ok", start() { ran.push("ok"); } });
    await k.start();
    expect(ran).toEqual(["ok"]);
    expect(failed).toHaveBeenCalledOnce();
  });
  it("shares services and survives throwing cleanups", async () => {
    const k = new Kernel(quiet());
    let seen = 0;
    k.register({ name: "p", start: (c) => { c.provide("n", 7); c.onStop(() => { throw new Error("x"); }); } });
    k.register({ name: "q", deps: ["p"], start: (c) => { seen = c.service<number>("n"); } });
    await k.start();
    expect(seen).toBe(7);
    await expect(k.stop()).resolves.toBeUndefined();
    expect(k.isRunning).toBe(false);
  });
});
