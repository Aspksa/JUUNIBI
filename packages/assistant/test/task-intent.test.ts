import { describe, expect, it } from "vitest";
import { classifyTaskIntent, taskExecutionInstructions } from "../src/task-intent";

describe("task completion guidance", () => {
  it("distinguishes a requested plan from an actual inspection", () => {
    expect(classifyTaskIntent("Составь план из 5 шагов по проверке модулей")).toBe("plan");
    expect(classifyTaskIntent("Проверь все модули и найди ошибки")).toBe("execute");
    expect(classifyTaskIntent("Проведи проверку компьютера")).toBe("execute");
    expect(classifyTaskIntent("Привет")).toBe("answer");
  });
  it("does not claim a planned check is completed", () => {
    expect(taskExecutionInstructions("Составь план")).toMatch(/не утверждай/);
    expect(taskExecutionInstructions("Проверь модули")).toMatch(/Не останавливайся/);
  });
  it("requires tool evidence and normal approval gates", () => {
    const text = taskExecutionInstructions("Проверь модули");
    expect(text).toMatch(/действительно вызванный/);
    expect(text).toMatch(/разрешений/);
    expect(text).toMatch(/Статус started/);
  });
});
