import { auditDraftPlan, type DraftPlan, type DraftStep } from "./plan-25-audit";

/** Conservative, read-only plan repair: never grants privileges or invents budgets/tools. */
export function proposePlanRepair(input: DraftPlan) {
 if(!input || !Array.isArray(input.steps) || input.steps.length<1 || input.steps.length>25 ||
  !input.steps.every(s=>s&&typeof s.id==="string"&&/^[a-zA-Z0-9_-]{1,50}$/.test(s.id)&&
   typeof s.title==="string"&&s.title.trim().length>0&&s.title.length<=120&&
   Array.isArray(s.dependsOn)&&s.dependsOn.every(d=>typeof d==="string")&&s.dependsOn.length<=20&&
   ["read","write","danger"].includes(s.risk)&&Number.isFinite(s.cost)&&s.cost>=0&&Number.isFinite(s.minutes)&&s.minutes>=0&&typeof s.approved==="boolean") ||
  new Set(input.steps.map(s=>s.id)).size!==input.steps.length)
  throw Object.assign(new Error("Нельзя безопасно исправить некорректную структуру плана"),{status:400});
 const original=auditDraftPlan(input),changes:string[]=[];
 const ids=new Set(input.steps.map(s=>s.id));
 const steps=input.steps.map(s=>({...s,dependsOn:[...s.dependsOn]}));
 for(const step of steps) {
   const deps=step.dependsOn.filter(d=>d!==step.id&&ids.has(d));
   if(deps.length!==step.dependsOn.length){changes.push("Для "+step.id+" исключены неизвестные или циклические ссылки на себя");step.dependsOn=deps;}
 }
 // Stable topological ordering. Cycles require human intervention; do not remove valid dependencies.
 const ordered:DraftStep[]=[],pending=[...steps],done=new Set<string>();
 while(pending.length) {
   const i=pending.findIndex(s=>s.dependsOn.every(d=>done.has(d)));
   if(i<0)break;
   const [step]=pending.splice(i,1);ordered.push(step!);done.add(step!.id);
 }
 const sorted=pending.length?steps:ordered;
 if(!pending.length&&sorted.some((s,i)=>s.id!==steps[i]!.id))changes.push("Шаги упорядочены по зависимостям");
 const candidate:DraftPlan={...input,steps:sorted,availableTools:Array.isArray(input.availableTools)?[...input.availableTools]:[]};
 const reassessed=auditDraftPlan(candidate);
 const remaining=reassessed.failed;
 return {original,candidate,reassessed,changes,remaining,
  improved:reassessed.passed>original.passed,requiresReview:true as const,
  executable:false as const,
  note:"Предложение не меняет цену, сроки, инструменты, риск и согласия. Непроверенные ограничения требуют решения владельца; фактическое выполнение всегда проверяется отдельно."};
}
