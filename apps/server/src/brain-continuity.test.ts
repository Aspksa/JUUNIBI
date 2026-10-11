import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("personal assistant continuity", () => {
  it("restores progress without resuming interrupted actions", async () => {
    let snapshot: string | null = null;
    const storage = { load: async () => snapshot, save: async (value: string) => { snapshot = value; } };
    const first = new BrainCore(() => true, storage);
    const plan = first.plan("Подготовить отчёт", ["Найти материалы", "Проверить данные", "Составить итог"]);
    first.updateStep(plan.id, plan.steps[0]!.id, "done");
    first.updateStep(plan.id, plan.steps[1]!.id, "active");
    await first.flush();

    const restored = new BrainCore(() => true, storage);
    await restored.load();
    const pending = restored.pendingWork();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: plan.id, completed: 1, total: 3,
      nextStep: { id: plan.steps[1]!.id, title: "Проверить данные", status: "pending" },
      requiresExplicitExecution: true
    });
    expect(restored.status().plans[0]?.steps.map(s => s.status)).toEqual(["done", "pending", "pending"]);
  });

  it("excludes completed plans and reports failures for manual review", async () => {
    const brain = new BrainCore(() => false);
    const ok = brain.plan("Готовое", ["Шаг"]);
    brain.updateStep(ok.id, ok.steps[0]!.id, "done");
    const error = brain.plan("Незавершённое", ["Сбой"]);
    brain.updateStep(error.id, error.steps[0]!.id, "failed");
    expect(brain.pendingWork()).toHaveLength(1);
    expect(brain.pendingWork()[0]).toMatchObject({id: error.id, nextStep:{status:"failed"}});
  });
});
