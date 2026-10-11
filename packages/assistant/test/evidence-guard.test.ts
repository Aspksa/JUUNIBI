import { describe, expect, it } from "vitest";
import { guardToolClaims } from "../src/evidence-guard";

describe("evidence guard", () => {
  it("flags tools falsely claimed as invoked this turn", () => {
    const reply = "Инвентаризация: `list_modules` ✅; процессы: `computer_processes` ✅.";
    const checked = guardToolClaims(reply, [{ name: "computer_processes", status: "ok" }]);
    expect(checked).toContain("Не подтверждено");
    expect(checked).toContain("`list_modules`");
  });
  it("does not treat failed tool calls as verified", () => {
    expect(guardToolClaims("`computer_status` ✅", [{ name: "computer_status", status: "error" }])).toContain("Не подтверждено");
  });
  it("notes that started is not equivalent to functional health", () => {
    expect(guardToolClaims("Все 7 модулей работают.", [])).toContain("не доказывает исправность");
  });
  it("leaves evidence-supported normal replies untouched", () => {
    const text = "Проверка `computer_status` ✅";
    expect(guardToolClaims(text, [{ name: "computer_status", status: "ok" }])).toBe(text);
  });
});
