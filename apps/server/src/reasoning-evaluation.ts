import { makeStructuredTask, gradeStructuredTask, type ReasoningCategory } from "./structured-reasoning";
export interface Evaluation { category: ReasoningCategory; correct: boolean; errorStep: number | null; at: string }
export class ReasoningEvaluation {
  private history: Evaluation[] = [];
  readonly categories: readonly ReasoningCategory[] = ["multi-step", "error-detection", "rule-transfer"];
  next(turn: number, difficulty: number) {
    return makeStructuredTask(this.categories[Math.abs(Math.floor(turn)) % this.categories.length]!, turn, difficulty);
  }
  evaluate(task: ReturnType<typeof makeStructuredTask>, answer: string) {
    const result = gradeStructuredTask(task, answer);
    this.history.push({ category: task.category, correct: result.correct, errorStep: result.firstIncorrectStep, at: new Date().toISOString() });
    this.history = this.history.slice(-100);
    return result;
  }
  load(data: unknown) {
    if (!Array.isArray(data)) return;
    this.history = data.filter((e): e is Evaluation =>
      e && this.categories.includes(e.category) && typeof e.correct === "boolean" && typeof e.at === "string" &&
      (e.errorStep === null || Number.isInteger(e.errorStep) && e.errorStep >= 1 && e.errorStep <= 3)).slice(-100);
  }
  snapshot() { return this.history.map(x => ({...x})); }
  summary() {
    return this.categories.map(category => {
      const items = this.history.filter(e => e.category === category);
      const correct = items.filter(e => e.correct).length;
      return { category, attempts: items.length, correct, accuracy: items.length ? Math.round(100*correct/items.length) : null };
    });
  }
}
