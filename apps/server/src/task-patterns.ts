import type { DecisionRecord } from "./decision-memory";
export interface TaskPattern {
  taskType: string; confirmed: number; failures: number; successRate: number;
  repeatedFailure: boolean; advice: string;
}
/** Owner-confirmed outcomes only. This is descriptive pattern analysis, not automatic learning or code changes. */
export function analyzeTaskPatterns(records: DecisionRecord[]): { patterns: TaskPattern[]; note: string } {
  const groups = new Map<string, { confirmed: number; failures: number }>();
  for (const record of records.slice(-100)) {
    if (!record.taskType || (record.observed !== "success" && record.observed !== "failure")) continue;
    const current = groups.get(record.taskType) ?? { confirmed: 0, failures: 0 };
    current.confirmed++;
    if (record.observed === "failure") current.failures++;
    groups.set(record.taskType, current);
  }
  const patterns = [...groups].map(([taskType, counts]) => ({
    taskType, confirmed: counts.confirmed, failures: counts.failures,
    successRate: Math.round(100 * (counts.confirmed-counts.failures) / counts.confirmed),
    repeatedFailure: counts.failures >= 3,
    advice: counts.failures >= 3
      ? "Повторяющиеся неудачи: провести проверку предположений, добавить контрольные тесты и запросить подтверждение владельца."
      : "Недостаточно подтверждённых неудач для выявления повторяющейся проблемы.",
  })).sort((a,b)=>Number(b.repeatedFailure)-Number(a.repeatedFailure) || b.failures-a.failures || a.taskType.localeCompare(b.taskType));
  return {patterns,note:"Паттерны основаны на подтверждениях владельца; рекомендации не выполняются автоматически."};
}
