import { evaluateOptions, type PlanLimits, type PlanOption } from "./plan-evaluator";

export interface SequenceStep extends PlanOption { after: string[] }
export interface SequenceResult {
  feasible: boolean; completed: string[]; failedAt: string | null; blockers: string[];
  remainingBudget: number; remainingTime: number; resources: Record<string, number>;
  trace: { step: string; feasible: boolean; blockers: string[] }[];
  requiresApproval: true;
}
/** Simulate an ordered dependency graph. No execution, network operations or mutations. */
export function simulateSequence(steps: SequenceStep[], limits: PlanLimits): SequenceResult {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 20)
    throw Object.assign(new Error("Допускается от 1 до 20 шагов"), { status: 400 });
  if (steps.some(s => !s || !Array.isArray(s.after) || s.after.length > 20 ||
    !s.after.every(d => typeof d === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(d))))
    throw Object.assign(new Error("Некорректные зависимости"), { status: 400 });
  const seen = new Set<string>(), ids = new Set(steps.map(s => s.id));
  if (ids.size !== steps.length || steps.some(s => s.after.includes(s.id) || s.after.some(dep => !ids.has(dep))))
    throw Object.assign(new Error("Дублирующиеся или неизвестные зависимости"), { status: 400 });
  // Validate every option and the baseline limits before simulation.
  for (const step of steps) evaluateOptions([step], limits);
  let budget = limits.budget, time = limits.deadline;
  const resources = { ...limits.resources };
  const completed: string[] = [];
  const trace: SequenceResult["trace"] = [];
  for (const step of steps) {
    const blockers = step.after.filter(dep => !seen.has(dep)).map(dep => "Не завершён шаг: " + dep);
    // Hard constraints are assessed against remaining resources and time.
    const assessment = evaluateOptions([step], { ...limits, budget, deadline: time, resources }).assessments[0]!;
    blockers.push(...assessment.blockers);
    const feasible = blockers.length === 0;
    trace.push({ step: step.id, feasible, blockers });
    if (!feasible) return { feasible: false, completed, failedAt: step.id, blockers,
      remainingBudget: budget, remainingTime: time, resources, trace, requiresApproval: true };
    budget -= step.cost; time -= step.duration;
    Object.assign(resources, assessment.resultingResources);
    completed.push(step.id); seen.add(step.id);
  }
  return { feasible: true, completed, failedAt: null, blockers: [],
    remainingBudget: budget, remainingTime: time, resources, trace, requiresApproval: true };
}
