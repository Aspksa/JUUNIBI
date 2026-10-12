/** Deterministic, previously unseen assessments. No model-generated answers are treated as evidence. */
export type ExamTask = { kind: "arithmetic"; question: string; expected: string; id: string };
/** Separate arithmetic family from the ordinary multiplication drills. */
export function makeHoldoutExam(turn: number, level: number): ExamTask {
  if (!Number.isSafeInteger(turn) || turn < 0 || !Number.isInteger(level) || level < 1 || level > 5)
    throw new Error("Invalid exam parameters");
  const a = 31 + ((turn * 17) % 37) * level;
  const b = 19 + ((turn * 13) % 29) * level;
  const c = 7 + (turn % 11);
  return {kind:"arithmetic",id:`exam-${turn}-${level}`,
    question:`Экзамен без подсказок. Вычисли (${a} + ${b}) − ${c}. Ответь только одним целым числом.`,
    expected:String(a+b-c)};
}
export function gradeHoldoutExam(task: ExamTask, answer: string): boolean {
  return typeof answer === "string" && /^[+-]?\d+$/.test(answer.trim()) && answer.trim() === task.expected;
}
