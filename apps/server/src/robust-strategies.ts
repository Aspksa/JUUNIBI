import { simulateSequence, type SequenceStep } from "./sequence-simulator";
import { suggestSequenceRepairs } from "./sequence-repair";
import type { PlanLimits } from "./plan-evaluator";

export type StressScenario = "baseline" | "cost-overrun" | "time-overrun" | "resource-shortage";
export interface StrategyReport {
  id: string; source: string; feasibleScenarios: number; totalScenarios: number;
  worstFailure: string | null; baselineFeasible: boolean; budgetReserve: number | null;
  scenarios: { name: StressScenario; feasible: boolean; failedAt: string | null; blockers: string[] }[];
}
function clone(steps: SequenceStep[]): SequenceStep[] {
  return steps.map(s => ({ ...s, after: [...s.after], requires: [...s.requires], effects: s.effects.map(e => ({...e})) }));
}
function stressed(steps: SequenceStep[], limits: PlanLimits, scenario: StressScenario) {
  const candidate=clone(steps);
  const updated: PlanLimits={...limits,available:[...limits.available],resources:{...limits.resources}};
  if (scenario==="cost-overrun") for (const s of candidate) s.cost=Math.ceil(s.cost*1.2);
  if (scenario==="time-overrun") for (const s of candidate) s.duration=Math.ceil(s.duration*1.2);
  if (scenario==="resource-shortage") for (const k of Object.keys(updated.resources)) updated.resources[k]=Math.floor(updated.resources[k]!*0.8);
  return simulateSequence(candidate,updated);
}
/** Compare counterfactual strategies under explicit stress assumptions, without executing or saving. */
export function compareRobustStrategies(steps: SequenceStep[],limits: PlanLimits) {
  const initial=simulateSequence(steps,limits);
  const repairs=suggestSequenceRepairs(steps,limits);
  const candidates=[{ id:"original", source:"Исходный план", steps:clone(steps) },
    ...repairs.suggestions.map((s,i)=>({id:"repair-"+(i+1),source:s.explanation,steps:clone(s.candidate)}))];
  const scenarios: StressScenario[]=["baseline","cost-overrun","time-overrun","resource-shortage"];
  const reports: StrategyReport[]=candidates.map(c=>{
    const evaluated=scenarios.map(name=>({name,result:stressed(c.steps,limits,name)}));
    const baseline=evaluated[0]!.result;
    return {id:c.id,source:c.source,feasibleScenarios:evaluated.filter(e=>e.result.feasible).length,
      totalScenarios:scenarios.length,worstFailure:evaluated.find(e=>!e.result.feasible)?.result.failedAt??null,
      baselineFeasible:baseline.feasible,budgetReserve:baseline.feasible?baseline.remainingBudget:null,
      scenarios:evaluated.map(e=>({name:e.name,feasible:e.result.feasible,failedAt:e.result.failedAt,blockers:e.result.blockers}))};
  });
  // A strategy must work in the baseline before it can be recommended.
  const ranked=reports.filter(r=>r.baselineFeasible).sort((a,b)=>
    b.feasibleScenarios-a.feasibleScenarios || (b.budgetReserve??0)-(a.budgetReserve??0) || a.id.localeCompare(b.id));
  return {initial,strategies:reports,recommendedId:ranked[0]?.id??null,
    assumptions:{costOverrun:0.2,timeOverrun:0.2,resourceReduction:0.2},
    note:"Сценарная проверка, а не статистическая вероятность успеха. Изменение затрат и сроков требует подтверждения реалистичности.",
    requiresApproval:true as const};
}
