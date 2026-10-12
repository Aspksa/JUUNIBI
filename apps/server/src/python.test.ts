import { describe, expect, it } from "vitest";
import { detectPython, missingPythonMessage, pythonCandidates, pythonInfo, resetPythonCache, runPythonJson, PythonUnavailableError, type Probe } from "./python";

const probeOf = (table: Record<string, { code: number | null; output: string } | "missing">): Probe => async (command, args) => {
  const hit = table[[command, ...args].join(" ")];
  if (!hit || hit === "missing") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return hit;
};
describe("поиск Python 3", () => {
  it("на Linux и macOS сначала python3, потом python", () => {
    expect(pythonCandidates("linux").map(([c]) => c)).toEqual(["python3", "python"]);
    expect(pythonCandidates("win32").map(([c, a]) => [c, ...a].join(" "))).toEqual(["python", "py -3", "python3"]);
  });
  it("находит подходящий Python и версию", async () => {
    const r = await detectPython(probeOf({ "python3 --version": { code: 0, output: "Python 3.12.3\n" } }), "linux");
    expect(r).toMatchObject({ ok: true, command: "python3", version: "3.12.3" });
  });
  it("заглушка Microsoft Store не считается Python, берётся следующий вариант", async () => {
    const store = { code: 9009, output: "Python was not found; run without arguments to install from the Microsoft Store" };
    const r = await detectPython(probeOf({ "python --version": store, "py -3 --version": { code: 0, output: "Python 3.11.9" } }), "win32");
    expect(r).toMatchObject({ ok: true, command: "py", args: ["-3"], version: "3.11.9" });
  });
  it("заглушка с нулевым кодом тоже отклоняется: нет строки версии", async () => {
    const r = await detectPython(probeOf({ "python --version": { code: 0, output: "Python was not found" } }), "win32");
    expect(r.ok).toBe(false);
  });
  it("слишком старый Python и Python 2 не подходят", async () => {
    expect((await detectPython(probeOf({ "python3 --version": { code: 0, output: "Python 3.6.9" } }), "linux")).ok).toBe(false);
    expect((await detectPython(probeOf({ "python --version": { code: 0, output: "Python 2.7.18" } }), "linux")).ok).toBe(false);
  });
  it("если ничего нет — понятное сообщение для своей системы", async () => {
    const win = await detectPython(probeOf({}), "win32");
    expect(win).toMatchObject({ ok: false });
    expect(win.reason).toMatch(/python\.org/);
    expect(missingPythonMessage("linux")).toMatch(/apt install python3/);
    expect(missingPythonMessage("darwin")).toMatch(/brew/);
    expect(win.reason).toMatch(/всё остальное работает/);
  });
  it("результат кэшируется: найденный надолго, отсутствующий ненадолго", async () => {
    resetPythonCache();
    let calls = 0;
    const missing: Probe = async () => { calls++; throw new Error("no"); };
    await pythonInfo(missing, 1_000); const first = calls;
    await pythonInfo(missing, 20_000);
    expect(calls).toBe(first);
    await pythonInfo(missing, 40_000);
    expect(calls).toBeGreaterThan(first);
    resetPythonCache();
  });
  it("без Python запуск скрипта сообщает об этом отдельной ошибкой с кодом 503", async () => {
    const err = await runPythonJson<unknown>("x.py", "db", {}, { ok: false, reason: "нет" }).then(() => undefined, (e: PythonUnavailableError) => e);
    expect(err).toBeInstanceOf(PythonUnavailableError);
    expect(err?.status).toBe(503);
    expect(err?.message).toBe("нет");
  });
});
