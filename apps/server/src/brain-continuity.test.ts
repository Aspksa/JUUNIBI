import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("personal assistant continuity", () => {
  it("prioritizes failures, then partial plans, then untouched plans without side effects", async () => {
    const brain = new BrainCore(() => true);
    const newPlan = brain.plan("Начать новый проект", ["Составить цели"]);
    const partial = brain.plan("Продолжить работу", ["Первый этап", "Второй этап"]);
    brain.updateStep(partial.id, partial.steps[0]!.id, "active");
    brain.updateStep(partial.id, partial.steps[0]!.id, "done");
    const broken = brain.plan("Исправить проблему", ["Диагностика"]);
    brain.updateStep(broken.id, broken.steps[0]!.id, "active");
    brain.updateStep(broken.id, broken.steps[0]!.id, "failed");
    const original = brain.status().plans;
    const feed = brain.attentionFeed(10);
    expect(feed.map(x => x.id)).toEqual([broken.id, partial.id, newPlan.id]);
    expect(feed[0]).toMatchObject({kind:"needs-review", priority:0, requiresExplicitExecution:true});
    expect(feed[1]).toMatchObject({kind:"resume", progress:{completed:1,total:2}});
    expect(brain.attentionFeed(1)).toHaveLength(1);
    expect(brain.status().plans).toEqual(original);
  });

  it("restores progress without resuming interrupted actions", async () => {
    let snapshot: string | null = null;
    const storage = { load: async () => snapshot, save: async (value: string) => { snapshot = value; } };
    const first = new BrainCore(() => true, storage);
    const plan = first.plan("Подготовить отчёт", ["Найти материалы", "Проверить данные", "Составить итог"]);
    first.updateStep(plan.id, plan.steps[0]!.id, "active");
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
    brain.updateStep(ok.id, ok.steps[0]!.id, "active");
    brain.updateStep(ok.id, ok.steps[0]!.id, "done");
    const error = brain.plan("Незавершённое", ["Сбой"]);
    brain.updateStep(error.id, error.steps[0]!.id, "active");
    brain.updateStep(error.id, error.steps[0]!.id, "failed");
    expect(brain.pendingWork()).toHaveLength(1);
    expect(brain.pendingWork()[0]).toMatchObject({id: error.id, nextStep:{status:"failed"}});
  });
});
