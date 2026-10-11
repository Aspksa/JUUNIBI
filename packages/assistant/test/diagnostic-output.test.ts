import { describe, expect, it } from "vitest";
import { compactDiagnosticOutput } from "../src/diagnostic-output";
import { guardToolClaims } from "../src/evidence-guard";

describe("diagnostic response reliability", () => {
  it("compresses process inventory but preserves counts", () => {
    const text = JSON.stringify([{name:"svchost.exe",pid:1},{name:"svchost.exe",pid:2},{name:"explorer.exe",pid:3}]);
    const compact = JSON.parse(compactDiagnosticOutput("computer_processes",text));
    expect(compact.count).toBe(3);
    expect(compact.byName).toContainEqual(["svchost.exe",2]);
  });
  it("does not truncate ordinary status reports below limit", () => {
    expect(compactDiagnosticOutput("computer_status","ok")).toBe("ok");
  });
  it("marks replayed diagnostics as cached, not freshly checked", () => {
    const report = guardToolClaims("Данные получены", [{name:"list_modules",status:"ok",at:Date.UTC(2026,9,11),source:"cache"}], "Проверь модули JUUNIBI");
    expect(report).toContain("Повторный отчёт (сохранённые данные)");
    expect(report).toContain("Новые вызовы инструментов");
  });
});
