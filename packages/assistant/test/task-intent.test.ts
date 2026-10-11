import { describe, expect, it } from "vitest";
import { classifyTaskIntent, taskExecutionInstructions } from "../src/task-intent";

describe("task completion guidance", () => {
  it("distinguishes a requested plan from an actual inspection", () => {
    expect(classifyTaskIntent("Составь план из 5 шагов по проверке модулей")).toBe("plan");
    expect(classifyTaskIntent("Проверь все модули и найди ошибки")).toBe("execute");
    expect(classifyTaskIntent("Проведи проверку компьютера")).toBe("execute");
    expect(classifyTaskIntent("Привет")).toBe("answer");
  });
  it("routes an explicit vacation record to authorized tools rather than idle dialogue", () => {
    const request = "запиши Водитель Котов Игорь Александрович отпуск с 12 октября по 23";
    expect(classifyTaskIntent(request)).toBe("record");
    expect(taskExecutionInstructions(request)).toMatch(/запись через доступный инструмент/);
    expect(taskExecutionInstructions(request)).toMatch(/отпуск владельца/);
    expect(taskExecutionInstructions(request)).toMatch(/подтвердил сохранение/);
    expect(classifyTaskIntent("Добавь заметку")).toBe("record");
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
