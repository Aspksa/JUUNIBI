import { simulateSequence, type SequenceStep } from "./sequence-simulator";
import type { PlanLimits } from "./plan-evaluator";

export interface RecoverySuggestion {
  type: "reduce-cost" | "reduce-duration" | "reduce-resource-use" | "reorder";
  stepId: string;
  explanation: string;
  candidate: SequenceStep[];
  feasible: boolean;
}
/** Generate explicit, bounded counterfactuals; never mutate inputs or execute plans. */
export function suggestSequenceRepairs(steps: SequenceStep[], limits: PlanLimits): {
  original: ReturnType<typeof simulateSequence>; suggestions: RecoverySuggestion[]; requiresApproval: true;
} {
  const original = simulateSequence(steps, limits);
  if (original.feasible) return { original, suggestions: [], requiresApproval: true };
  const failed = steps.findIndex(s => s.id === original.failedAt);
  if (failed < 0) return { original, suggestions: [], requiresApproval: true };
  const step = steps[failed]!;
  const changes: { type: RecoverySuggestion["type"]; explanation: string; edit: (s: SequenceStep) => SequenceStep }[] = [];
  if (original.blockers.includes("Превышен бюджет"))
    changes.push({ type: "reduce-cost", explanation: "Снизить стоимость проблемного этапа до оставшегося бюджета", edit: s => ({ ...s, cost: original.remainingBudget }) });
  if (original.blockers.includes("Превышен срок"))
    changes.push({ type: "reduce-duration", explanation: "Сократить длительность этапа до оставшегося срока", edit: s => ({ ...s, duration: original.remainingTime }) });
  for (const [name, value] of Object.entries(original.resources)) {
    if (!original.blockers.includes("Недостаточно ресурса: " + name)) continue;
    changes.push({ type: "reduce-resource-use", explanation: "Уменьшить расход ресурса " + name, edit: s => ({
      ...s, effects: s.effects.map(e => e.resource === name && e.delta < 0 ? { ...e, delta: Math.max(e.delta, -value) } : { ...e }),
    }) });
  }
  if (original.blockers.some(b => b.startsWith("Не завершён шаг: ")))
    changes.push({ type: "reorder", explanation: "Переставить этап после всех его зависимостей", edit: s => ({ ...s }) });
  const suggestions: RecoverySuggestion[] = [];
  for (const change of changes.slice(0, 5)) {
    let candidate = steps.map(s => ({ ...s, after: [...s.after], requires: [...s.requires], effects: s.effects.map(e => ({...e})) }));
    if (change.type === "reorder") {
      const prerequisite = candidate.filter(s => step.after.includes(s.id));
      const lastIndex = Math.max(-1, ...prerequisite.map(s => candidate.findIndex(x => x.id === s.id)));
      if (lastIndex <= failed) continue;
      const moved = candidate.splice(failed, 1)[0]!;
      candidate.splice(lastIndex, 0, moved);
    } else candidate[failed] = change.edit(candidate[failed]!);
    const result = simulateSequence(candidate, limits);
    suggestions.push({ type: change.type, stepId: step.id, explanation: change.explanation,
      candidate, feasible: result.feasible });
  }
  return { original, suggestions, requiresApproval: true };
}
