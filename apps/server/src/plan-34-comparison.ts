import { auditDraftPlan, type DraftPlan } from "./plan-25-audit";
import { proposePlanRepair } from "./plan-repair";

/** 25 existing plan checks plus 9 comparison safeguards; suggestions never execute. */
export function comparePlanVariants(input: DraftPlan, alternatives: DraftPlan[]) {
 if (!Array.isArray(alternatives) || alternatives.length>5) throw Object.assign(new Error("Допускается до пяти альтернатив"),{status:400});
 const original=auditDraftPlan(input);
 const baseline=JSON.stringify(input);
 const candidates=[input,...alternatives].map((plan,index)=>{
   const audit=auditDraftPlan(plan);
   const originalIds=input.steps.map(s=>s.id);
   const sameSteps=plan.steps.length===originalIds.length&&plan.steps.every(s=>originalIds.includes(s.id))&&new Set(plan.steps.map(s=>s.id)).size===originalIds.length;
   const stepIdentity=sameSteps&&plan.steps.every(s=>{
     const old=input.steps.find(x=>x.id===s.id)!;
     return s.title===old.title&&s.tool===old.tool&&s.risk===old.risk&&s.cost===old.cost&&s.minutes===old.minutes&&s.approved===old.approved;
   });
   const sameResources=plan.budget===input.budget&&plan.deadline===input.deadline;
   const sameTools=JSON.stringify(plan.availableTools)===JSON.stringify(input.availableTools);
   const sameGoal=plan.goal===input.goal;
   const safeDependencies=stepIdentity&&plan.steps.every(s=>{
     const old=input.steps.find(x=>x.id===s.id)!;
     return s.dependsOn.every(d=>old.dependsOn.includes(d));
   });
   const review=proposePlanRepair({...plan,steps:plan.steps});
   const checks=[
     ["baseline_integrity",JSON.stringify(input)===baseline],
     ["same_goal",sameGoal],
     ["same_step_identity",stepIdentity],
     ["same_budget_and_deadline",sameResources],
     ["same_available_tools",sameTools],
     ["no_added_dependencies",safeDependencies],
     ["no_new_privileges",stepIdentity],
     ["audit_passes",audit.failed.length===0],
     ["repair_still_nonexecuting",review.executable===false]
   ] as const;
   const valid=checks.every(x=>x[1]);
   return {index,valid,checks:checks.map(([id,passed],i)=>({stage:i+26,id,passed})),
     audit,estimatedCost:audit.estimatedCost,estimatedMinutes:audit.estimatedMinutes,
     riskScore:plan.steps.reduce((n,s)=>n+(s.risk==="danger"?3:s.risk==="write"?2:1),0)};
 });
 const ranked=candidates.filter(x=>x.valid).sort((a,b)=>a.riskScore-b.riskScore||
   a.estimatedCost-b.estimatedCost||a.estimatedMinutes-b.estimatedMinutes||a.index-b.index);
 return {original,reviewStages:34,candidates,recommendedIndex:ranked[0]?.index??null,
  requiresApproval:true as const,executable:false as const,
  note:"Выбор по заданным ограничениям и оценкам; не доказательство эффективности. Разрешения при фактическом запуске проверяются отдельно."};
}
