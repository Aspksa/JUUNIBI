export type ReasoningCategory = "multi-step" | "error-detection" | "rule-transfer";
export interface StructuredTask {
  category: ReasoningCategory;
  question: string;
  expected: string;
  steps: number[];
  difficulty: number;
}
/** Deterministic closed-world exercises. The oracle is never included in the prompt. */
export function makeStructuredTask(category: ReasoningCategory, turn: number, difficulty = 1): StructuredTask {
  const t = Math.max(1, Math.min(100000, Math.floor(turn)));
  const level = Math.max(1, Math.min(5, Math.floor(difficulty)));
  const a = 3 + t % 13, b = 2 + level + t % 5, c = 1 + level + t % 7;
  if (category === "multi-step") {
    const x = a + b, y = x * c, z = y - b;
    return { category, difficulty: level, steps: [x,y,z], expected: [x,y,z].join(","),
      question: `Начальное число ${a}. Шаг 1: прибавь ${b}. Шаг 2: умножь результат на ${c}. Шаг 3: вычти ${b}. Ответь тремя числами через запятую — результат каждого шага.` };
  }
  if (category === "error-detection") {
    const x = a + b, wrong = x * c + 1, z = wrong - b;
    return { category, difficulty: level, steps: [x,x*c,x*c-b], expected: "2",
      question: `Проверь вычисления: старт ${a}; шаг 1 (+${b}) = ${x}; шаг 2 (×${c}) = ${wrong}; шаг 3 (−${b}) = ${z}. Назови номер ПЕРВОГО неверного шага одним числом.` };
  }
  const start = a, delta = b, next = start + 5 * delta;
  return { category, difficulty: level, steps: [start+delta,start+2*delta,next], expected: String(next),
    question: `Последовательность: ${start}, ${start+delta}, ${start+2*delta}. Правило — постоянная прибавка. Найди шестой элемент без объяснения, ответь одним числом.` };
}
export function gradeStructuredTask(task: StructuredTask, output: string): { correct: boolean; firstIncorrectStep: number | null } {
  const response = output.trim();
  if (task.category !== "multi-step")
    return { correct: response === task.expected, firstIncorrectStep: response === task.expected ? null : 1 };
  const actual = response.split(",").map(v => v.trim());
  if (actual.length !== task.steps.length) return { correct: false, firstIncorrectStep: 1 };
  const wrongAt = actual.findIndex((v, i) => !/^-?\d+$/.test(v) || Number(v) !== task.steps[i]);
  return { correct: wrongAt === -1, firstIncorrectStep: wrongAt === -1 ? null : wrongAt + 1 };
}
