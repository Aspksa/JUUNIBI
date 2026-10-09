/** Closed-world reasoning tasks; answers are computed locally, never entrusted to model self-grading. */
export interface ReasoningTask { kind: "logic" | "transfer"; question: string; expected: string }
export function makeReasoningTask(kind: "logic" | "transfer", turn: number): ReasoningTask {
  const n = Math.max(1, Math.min(10000, Math.trunc(turn)));
  if (kind === "logic") {
    const a = 3 + n % 11, b = 4 + n % 7;
    return { kind, question: `Правило: если число делится на 2 без остатка, ответ ДА, иначе НЕТ. Примените правило к числу ${a * b + 1}. Ответь одним словом ДА или НЕТ.`,
      expected: (a * b + 1) % 2 === 0 ? "ДА" : "НЕТ" };
  }
  const start = 2 + n % 9, step = 2 + n % 5;
  return { kind, question: `Правило последовательности: каждый следующий элемент больше предыдущего на ${step}. Примеры: ${start}, ${start + step}, ${start + step * 2}. Какой будет шестой элемент? Ответь одним целым числом.`,
    expected: String(start + step * 5) };
}
export function checkReasoningAnswer(task: ReasoningTask, answer: string): boolean {
  return answer.trim().toUpperCase() === task.expected;
}
