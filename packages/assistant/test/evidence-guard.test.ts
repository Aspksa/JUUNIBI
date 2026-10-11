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
  it("labels diagnostic steps without a current tool call as unverified", () => {
    const report = guardToolClaims("Все 7 модулей запущены. Процессы без аномалий.", [], "Выполни все шаги проверки модулей JUUNIBI");
    expect(report).toContain("Протокол текущей диагностики");
    expect(report).toContain("Не проверено");
    expect(report).toContain("нет вызова в текущем запросе");
  });
  it("reports only successful instrument results and timestamps", () => {
    const report = guardToolClaims("Проверка", [{ name: "list_modules", status: "ok", at: Date.UTC(2026, 9, 11) }, { name: "computer_status", status: "error" }], "Проверь модули и компьютер");
    expect(report).toContain("2026-10-11T00:00:00.000Z");
    expect(report).toContain("Ошибка/отказ");
    expect(report).toContain("Не проверено");
  });
  it("does not run diagnostics for a plan-only request", () => {
    const report = guardToolClaims("План: пять шагов", [], "Составь план проверки модулей");
    expect(report).not.toContain("Протокол текущей диагностики");
  });
  it("scopes functional health report to its requested tool", () => {
    const text = guardToolClaims("4 PASS 3 SKIPPED", [{ name: "functional_health_check", status: "ok", at: Date.UTC(2026, 9, 11) }], "Вызови functional_health_check и проверь модули");
    expect(text).toContain("Протокол функциональной диагностики");
    expect(text).toContain("2026-10-11T00:00:00.000Z");
    expect(text).not.toContain("Диагностика компьютера | Не проверено");
    expect(text).toContain("не означает PASS каждого");
  });
  it("flags missing functional tool instead of claiming execution", () => {
    const text = guardToolClaims("Готово", [], "Вызови functional_health_check");
    expect(text).toContain("Не проверено");
    expect(text).not.toContain("Протокол текущей диагностики");
  });
  it("exposes all actually executed tools even on functional-only request", () => {
    const report = guardToolClaims("В текущем запросе вызван только functional_health_check; другие инструменты не вызывались.", [
      { name: "list_modules", status: "ok", at: 1 },
      { name: "computer_status", status: "ok", at: 2 },
      { name: "computer_processes", status: "ok", at: 3 },
      { name: "functional_health_check", status: "ok", at: 4 },
    ], "Вызови functional_health_check и проверь модули");
    expect(report).toContain("ошибочно утверждается");
    expect(report).toContain("Полный журнал инструментов текущего запроса");
    expect(report).toContain("| computer_processes | ok |");
    expect(report).toContain("| functional_health_check | ok |");
  });
  it("distinguishes cached evidence in complete ledger", () => {
    const report = guardToolClaims("Проверка", [{ name: "list_modules", status: "ok", at: 1000, source: "cache" }], "Проверь модули JUUNIBI");
    expect(report).toContain("сохранённые данные");
  });
  it("does not count denied tool as successful", () => {
    const report = guardToolClaims("Проверка", [{ name: "functional_health_check", status: "denied" }], "Вызови functional_health_check");
    expect(report).toContain("Ошибка/отказ");
    expect(report).toContain("| functional_health_check | denied |");
  });
  it("keeps each repeated call visible rather than deduplicating", () => {
    const report = guardToolClaims("Готово", [{ name: "list_modules", status: "error" }, { name: "list_modules", status: "ok" }], "Проверь модули JUUNIBI");
    expect(report.split("**Полный журнал инструментов текущего запроса:**")[1]!.split("| list_modules |").length - 1).toBe(2);
  });
  it.each([
    "Вызван только functional_health_check",
    "Вызывался исключительно functional_health_check",
    "Другие инструменты не вызывались",
  ])("flags contradictory exclusivity: %s", (claim) => {
    const r = guardToolClaims(claim, [{name:"functional_health_check",status:"ok"},{name:"list_modules",status:"ok"}], "Вызови functional_health_check");
    expect(r).toContain("ошибочно утверждается");
  });
  it("leaves evidence-supported normal replies untouched", () => {
    const text = "Проверка `computer_status` ✅";
    expect(guardToolClaims(text, [{ name: "computer_status", status: "ok" }])).toContain(text);
  });
});
