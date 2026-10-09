/** 25 bounded, non-executing checks of a proposed plan. Checks are advisory, not authorization. */
export interface DraftStep {
 id:string; title:string; tool?:string; risk:"read"|"write"|"danger";
 dependsOn:string[]; cost:number; minutes:number; approved:boolean;
}
export interface DraftPlan {
 goal:string; steps:DraftStep[]; budget:number; deadline:number; availableTools:string[];
}
export function auditDraftPlan(p:DraftPlan) {
 const steps=Array.isArray(p?.steps)?p.steps:[];
 const tools=Array.isArray(p?.availableTools)?p.availableTools:[];
 const safe=(x:unknown,max=120)=>typeof x==="string"&&x.trim().length>0&&x.length<=max;
 const ids=steps.map(x=>x?.id);
 const validSteps=steps.every(x=>x&&safe(x.id,50)&&safe(x.title,120)&&["read","write","danger"].includes(x.risk)&&
   Array.isArray(x.dependsOn)&&x.dependsOn.length<=20&&x.dependsOn.every(d=>safe(d,50))&&
   Number.isFinite(x.cost)&&Number.isFinite(x.minutes)&&typeof x.approved==="boolean");
 const totalCost=steps.reduce((s,x)=>s+(Number.isFinite(x?.cost)?x.cost:0),0);
 const totalMinutes=steps.reduce((s,x)=>s+(Number.isFinite(x?.minutes)?x.minutes:0),0);
 const known=new Set(ids), seen=new Set<string>();
 const inOrder=steps.every(x=>{const ok=x.dependsOn?.every(d=>seen.has(d))??false;seen.add(x.id);return ok;});
 const checks:[string,boolean][]=[
 ["goal_present",safe(p?.goal,500)],
 ["steps_present",steps.length>0],
 ["step_limit",steps.length<=25],
 ["step_shape",validSteps],
 ["unique_ids",new Set(ids).size===ids.length],
 ["id_syntax",ids.every(x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{1,50}$/.test(x))],
 ["titles_present",steps.every(x=>safe(x?.title))],
 ["valid_risk_levels",steps.every(x=>["read","write","danger"].includes(x?.risk))],
 ["nonnegative_costs",steps.every(x=>Number.isFinite(x?.cost)&&x.cost>=0)],
 ["nonnegative_durations",steps.every(x=>Number.isFinite(x?.minutes)&&x.minutes>=0)],
 ["finite_budget",Number.isFinite(p?.budget)],
 ["nonnegative_budget",Number.isFinite(p?.budget)&&p.budget>=0],
 ["finite_deadline",Number.isFinite(p?.deadline)],
 ["nonnegative_deadline",Number.isFinite(p?.deadline)&&p.deadline>=0],
 ["within_budget",Number.isFinite(p?.budget)&&totalCost<=p.budget],
 ["within_deadline",Number.isFinite(p?.deadline)&&totalMinutes<=p.deadline],
 ["dependencies_arrays",steps.every(x=>Array.isArray(x?.dependsOn))],
 ["dependencies_known",steps.every(x=>Array.isArray(x?.dependsOn)&&x.dependsOn.every(d=>known.has(d)))],
 ["no_self_dependencies",steps.every(x=>Array.isArray(x?.dependsOn)&&!x.dependsOn.includes(x.id))],
 ["dependency_order",inOrder],
 ["tool_list_valid",tools.length<=50&&tools.every(x=>safe(x,64)&&/^[a-zA-Z0-9_-]+$/.test(x))],
 ["tool_list_unique",new Set(tools).size===tools.length],
 ["requested_tools_available",steps.every(x=>x?.tool===undefined||tools.includes(x.tool))],
 ["write_requires_approval",steps.every(x=>x?.risk!=="write"||x.approved===true)],
 ["danger_requires_approval",steps.every(x=>x?.risk!=="danger"||x.approved===true)]
 ];
 const results=checks.map(([id,passed],i)=>({stage:i+1,id,passed}));
 return {total:25,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).map(x=>x.id),
  checks:results,estimatedCost:totalCost,estimatedMinutes:totalMinutes,
  executable:false as const,requiresRuntimeApproval:true as const,
  note:"Согласие в черновике не заменяет реальную проверку разрешений перед выполнением. Проверки не исполняют план."};
}
