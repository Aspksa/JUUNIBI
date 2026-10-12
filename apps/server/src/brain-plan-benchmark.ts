import type { BrainPlan } from "./brain";
export function evaluatePlanBenchmarks(plans:BrainPlan[]) {
  const cases=[
    {id:"empty-goal",check:(p:BrainPlan)=>p.goal.trim().length>0},
    {id:"has-steps",check:(p:BrainPlan)=>p.steps.length>0},
    {id:"unique-step-ids",check:(p:BrainPlan)=>new Set(p.steps.map(s=>s.id)).size===p.steps.length},
    {id:"bounded-complexity",check:(p:BrainPlan)=>p.steps.length<=60},
    {id:"completed-evidence",check:(p:BrainPlan)=>p.status!=="completed"||p.steps.every(s=>s.status==="done")},
    {id:"failed-state",check:(p:BrainPlan)=>p.status!=="failed"||p.steps.some(s=>s.status==="failed")},
  ];
  return {plansEvaluated:plans.length,cases:cases.map(c=>({id:c.id,passed:plans.filter(c.check).length,total:plans.length})),
    caveat:"Структурные проверочные задачи, не измерение интеллекта или фактической успешности действий."};
}
