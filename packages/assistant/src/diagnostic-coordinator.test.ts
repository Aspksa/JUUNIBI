import { describe, expect, it, vi } from "vitest";
import { DiagnosticCoordinator } from "./diagnostic-coordinator";
import { ToolExecutor } from "./tool-executor";
import { ToolRegistry, type Tool } from "./tools";

const make = (items: Tool[]) => {
  const tools = new ToolRegistry();
  for (const item of items) tools.register(item);
  const executor = new ToolExecutor({ tools, approve: () => false });
  return { tools, coordinator: new DiagnosticCoordinator({ tools, executor }) };
};

const read = (name: string, run: Tool["run"]): Tool => ({
  name,
  description: name,
  risk: "read",
  parameters: { type: "object", properties: {} },
  run,
});

describe("DiagnosticCoordinator", () => {
  it("runs deterministic module diagnostics through read-only ToolExecutor", async () => {
    const calls = vi.fn(() => "ok");
    const { coordinator } = make([
      read("list_modules", calls),
      read("computer_status", calls),
      read("computer_processes", () => JSON.stringify([{ name: "a" }, { name: "a" }, { name: "b" }])),
    ]);

    const batch = await coordinator.prepareBatch(
      "Проверь модули JUUNIBI и компьютер",
      "s",
      [],
    );

    expect(batch.active).toBe(true);
    expect(batch.used).toEqual(["list_modules", "computer_status", "computer_processes"]);
    expect(batch.evidence).toHaveLength(3);
    expect(batch.systemMessage).toContain("ПРОВЕРЕННЫЙ РЕЗУЛЬТАТ ДИАГНОСТИКИ");
    expect(batch.systemMessage).toContain('"count":3');
  });

  it("reuses failed-at-model-stage diagnostics as explicitly cached evidence", async () => {
    let runs = 0;
    const tool = (name: string) => read(name, () => { runs++; return "ok"; });
    const { coordinator } = make([
      tool("list_modules"),
      tool("computer_status"),
      tool("computer_processes"),
    ]);

    const first = await coordinator.prepareBatch("Проверь модули JUUNIBI", "s", []);
    expect(runs).toBe(3);
    const second = await coordinator.prepareBatch("Проверь модули JUUNIBI", "s", []);
    expect(runs).toBe(3);
    expect(second.evidence.every((item) => item.source === "cache")).toBe(true);

    coordinator.complete(second);
    await coordinator.prepareBatch("Проверь модули JUUNIBI", "s", []);
    expect(runs).toBe(6);
    coordinator.complete(first);
  });

  it("renders functional health from trusted tool output without another model call", async () => {
    const { coordinator } = make([
      read("functional_health_check", () => JSON.stringify({
        results: [{ module: "memory", status: "PASS", durationMs: 3, detail: "ok" }],
        checkedAt: "2026-10-15T00:00:00.000Z",
      })),
    ]);
    const result = await coordinator.runFunctional("Выполни functional_health_check");
    expect(result?.used).toEqual(["functional_health_check"]);
    expect(result?.reply).toContain("Функциональная диагностика");
    expect(result?.reply).toContain("memory");
    expect(result?.reply).toContain("Полный журнал инструментов");
  });

  it("refuses functional health when the registered tool is not read-only", async () => {
    let ran = 0;
    const { coordinator } = make([{
      name: "functional_health_check",
      description: "",
      risk: "write",
      parameters: { type: "object", properties: {} },
      run: () => { ran++; return "bad"; },
    }]);
    const result = await coordinator.runFunctional("Проверь functional_health_check");
    expect(result?.reply).toContain("не выполнена");
    expect(result?.evidence[0]?.status).toBe("denied");
    expect(ran).toBe(0);
  });

  it("keeps plan-only requests outside deterministic diagnostics", async () => {
    const { coordinator } = make([]);
    const batch = await coordinator.prepareBatch(
      "Составь план проверки модулей JUUNIBI",
      "s",
      [],
    );
    expect(batch.active).toBe(false);
  });
});
