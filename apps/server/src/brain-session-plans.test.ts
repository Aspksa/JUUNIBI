import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("Brain session-bound plans", () => {
  it("scopes pending work while retaining legacy unbound plans for global view", () => {
    const brain = new BrainCore(() => true);
    const one = brain.plan("Сборка", ["Проверить CI"], "chat-a");
    brain.plan("Другая задача", ["Проверить отчёт"], "chat-b");
    brain.plan("Старый план", ["Проверить вручную"]);
    expect(brain.pendingWork("chat-a").map(p => p.id)).toEqual([one.id]);
    expect(brain.pendingWork("chat-z")).toEqual([]);
    expect(brain.pendingWork()).toHaveLength(3);
    expect(() => brain.plan("Ошибка", ["Шаг"], "")).toThrow();
  });
});
