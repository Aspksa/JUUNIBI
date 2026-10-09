import { simulateSequence, type SequenceStep } from "./sequence-simulator";
import type { PlanLimits } from "./plan-evaluator";

export interface DecisionBranch {
  id: string; priority: number; steps: SequenceStep[];
}
export interface DecisionEvent {
  id: string; budgetDelta?: number; deadlineDelta?: number;
  resourceDeltas?: Record<string, number>; unavailable?: string[];
}
function invalid(): never { throw Object.assign(new Error("Некорректное дерево решений или событие"), {status:400}); }
function copyLimits(x: PlanLimits): PlanLimits {
  return {...x,available:[...x.available],resources:{...x.resources}};
}
/** Re-evaluate primary and fallback plans after an explicit event; no actions are executed. */
export function evaluateDecisionTree(branches: DecisionBranch[], limits: PlanLimits, event?: DecisionEvent) {
  if (!Array.isArray(branches) || branches.length < 1 || branches.length > 8 ||
      branches.some(b=>!b || typeof b.id!=="string" || !/^[\w-]{1,50}$/.test(b.id) ||
        !Number.isInteger(b.priority) || b.priority < 1 || b.priority > 5) ||
      new Set(branches.map(b=>b.id)).size !== branches.length) invalid();
  const changed=copyLimits(limits);
  if (event) {
    if (typeof event.id!=="string" || event.id.length>80 ||
        ![event.budgetDelta,event.deadlineDelta].every(v=>v===undefined || typeof v==="number" && Number.isFinite(v) && Math.abs(v)<=1000000) ||
        event.resourceDeltas && (typeof event.resourceDeltas!=="object" || Array.isArray(event.resourceDeltas) ||
          Object.keys(event.resourceDeltas).length>40 || Object.values(event.resourceDeltas).some(v=>!Number.isFinite(v) || Math.abs(v)>1000000)) ||
        event.unavailable && (!Array.isArray(event.unavailable) || event.unavailable.length>40 || event.unavailable.some(x=>typeof x!=="string" || x.length>50))) invalid();
    changed.budget=Math.max(0,changed.budget+(event.budgetDelta??0));
    changed.deadline=Math.max(0,changed.deadline+(event.deadlineDelta??0));
    for (const [k,v] of Object.entries(event.resourceDeltas??{})) {
      if (!Object.hasOwn(changed.resources,k)) invalid();
      changed.resources[k]=Math.max(0,changed.resources[k]!+v);
    }
    changed.available=changed.available.filter(a=>!event.unavailable?.includes(a));
  }
  const evaluations=branches.map(b=>{
    const outcome=simulateSequence(b.steps,changed);
    return {id:b.id,priority:b.priority,feasible:outcome.feasible,failedAt:outcome.failedAt,
      blockers:outcome.blockers,remainingBudget:outcome.remainingBudget,remainingTime:outcome.remainingTime};
  });
  const ranked=evaluations.filter(e=>e.feasible).sort((a,b)=>b.priority-a.priority ||
    b.remainingBudget-a.remainingBudget || a.id.localeCompare(b.id));
  const selected=ranked[0]??null;
  return {eventId:event?.id??null,branches:evaluations,
    selectedId:selected?.id??null,alternativeIds:ranked.slice(1).map(e=>e.id),
    rationale:selected ? "Выбран допустимый план с наивысшим заданным приоритетом: "+selected.id :
      "Нет допустимых планов при текущих ограничениях",
    changedLimits:changed,requiresApproval:true as const};
}
