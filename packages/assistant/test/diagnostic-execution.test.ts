import { describe, it, expect } from "vitest";
import { needsModuleDiagnosticExecution } from "../src/diagnostic-execution";

describe("deterministic diagnostics intent", () => {
  it("executes a concrete diagnostics request", () => {
    expect(needsModuleDiagnosticExecution("JUUNIBI, выполни полную диагностику всех модулей и компьютера")).toBe(true);
    expect(needsModuleDiagnosticExecution("Проверь модули JUUNIBI")).toBe(true);
  });
  it("does not run when asked to draft a plan", () => {
    expect(needsModuleDiagnosticExecution("Составь план из пяти шагов проверки модулей JUUNIBI")).toBe(false);
  });
  it("resolves repeat shorthand against recent module diagnostic context", () => {
    expect(needsModuleDiagnosticExecution("Ещё раз выполни все шаги", [{ role: "user", content: "Выполни проверку модулей JUUNIBI" }])).toBe(true);
    expect(needsModuleDiagnosticExecution("Выполни все шаги", [{ role: "user", content: "Приготовь ужин" }])).toBe(false);
  });
});
