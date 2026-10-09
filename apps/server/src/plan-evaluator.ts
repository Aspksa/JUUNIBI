/** Pure read-only planning evaluator. No tool execution or model-defined actions. */
export interface PlanOption {
  id: string;
  title: string;
  cost: number;
  duration: number;
  risk: number;
  benefit: number;
  requires: string[];
  effects: { resource: string; delta: number }[];
}
export interface PlanLimits {
  budget: number;
  deadline: number;
  maxRisk: number;
  available: string[];
  resources: Record<string, number>;
}
export interface PlanAssessment {
  id: string;
  feasible: boolean;
  blockers: string[];
  remainingBudget: number;
  remainingTime: number;
  resultingResources: Record<string, number>;
  score: number | null;
}
function bad(message: string): never { throw Object.assign(new Error(message), {status: 400}); }
const bounded = (n: unknown, max = 1000000): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
const safeName = (x: unknown): x is string => typeof x === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(x);
export function evaluateOptions(options: PlanOption[], limits: PlanLimits): {
  assessments: PlanAssessment[]; recommendedId: string | null; requiresApproval: true;
} {
  if (!Array.isArray(options) || options.length < 1 || options.length > 12 ||
      !limits || !bounded(limits.budget) || !bounded(limits.deadline) || !bounded(limits.maxRisk, 100) ||
      !Array.isArray(limits.available) || limits.available.length > 40 ||
      !limits.available.every(safeName) || !limits.resources || typeof limits.resources !== "object" ||
      Array.isArray(limits.resources) || Object.keys(limits.resources).length > 40 ||
      !Object.entries(limits.resources).every(([k,v])=> safeName(k) && bounded(v)))
    bad("Некорректные ограничения");
  if (options.some(o => !o || !safeName(o.id) || typeof o.title !== "string" || !o.title.trim() || o.title.length > 160 ||
      !bounded(o.cost) || !bounded(o.duration) || !bounded(o.risk,100) || !bounded(o.benefit) ||
      !Array.isArray(o.requires) || o.requires.length > 20 || !o.requires.every(safeName) ||
      !Array.isArray(o.effects) || o.effects.length > 20 ||
      !o.effects.every(e => e && safeName(e.resource) && typeof e.delta === "number" &&
        Number.isFinite(e.delta) && Math.abs(e.delta) <= 1000000)))
    bad("Недопустимый вариант плана");
  if (new Set(options.map(o=>o.id)).size !== options.length) bad("Повторяющиеся идентификаторы");
  const available = new Set(limits.available);
  const assessments = options.map(o => {
    const blockers: string[] = [];
    if (o.cost > limits.budget) blockers.push("Превышен бюджет");
    if (o.duration > limits.deadline) blockers.push("Превышен срок");
    if (o.risk > limits.maxRisk) blockers.push("Риск выше допустимого");
    for (const dependency of o.requires) if (!available.has(dependency)) blockers.push("Отсутствует условие: " + dependency);
    const resultingResources = { ...limits.resources };
    for (const effect of o.effects) {
      if (!Object.hasOwn(resultingResources,effect.resource)) {
        blockers.push("Неизвестный ресурс: " + effect.resource);
        continue;
      }
      resultingResources[effect.resource]! += effect.delta;
      if (resultingResources[effect.resource]! < 0) blockers.push("Недостаточно ресурса: " + effect.resource);
    }
    const feasible = blockers.length === 0;
    // Score is only a transparent heuristic; infeasible plans are never recommended.
    return {id:o.id, feasible, blockers, remainingBudget:limits.budget-o.cost,
      remainingTime:limits.deadline-o.duration, resultingResources,
      score: feasible ? o.benefit - o.cost * 0.1 - o.duration * 0.1 - o.risk * 2 : null};
  });
  const best = assessments.filter(a=>a.feasible).sort((a,b)=>(b.score??0)-(a.score??0) || a.id.localeCompare(b.id))[0];
  return {assessments,recommendedId:best?.id??null,requiresApproval:true};
}
