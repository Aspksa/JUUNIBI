import type { BrainPlan } from "./brain";
import type { DecisionRecord } from "./decision-memory";

export interface StrategyProposal { name:string; risk:"low"|"medium"|"high"; reversible:boolean; dependsOn?:string[] }
const err = (message:string) => Object.assign(new Error(message),{status:400});
const tokens = (s:string) => new Set(s.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{2,}/gu) ?? []);
const shares = (a:string,b:string) => [...tokens(a)].some(t=>tokens(b).has(t));

/** Read-only cognitive pipeline. Evidence and execution permissions remain separate. */
export function inspectCognitiveEngine(plan:BrainPlan, history:DecisionRecord[], input:unknown) {
  if(!input || typeof input!=="object") throw err("Некорректные стратегии");
  const payload = input as {strategies?:unknown; taskType?:unknown};
  if(!Array.isArray(payload.strategies) || payload.strategies.length<2 || payload.strategies.length>8) throw err("Нужно 2–8 стратегий");
  if(payload.taskType!==undefined && (typeof payload.taskType!=="string" || !payload.taskType.trim() || payload.taskType.length>60)) throw err("Некорректный тип задачи");
  const strategies:StrategyProposal[] = payload.strategies.map((raw:unknown)=>{
    if(!raw || typeof raw!=="object") throw err("Некорректная стратегия");
    const o=raw as Partial<StrategyProposal>;
    if(typeof o.name!=="string" || !o.name.trim() || o.name.length>150 || !["low","medium","high"].includes(o.risk??"") || typeof o.reversible!=="boolean" ||
      (o.dependsOn!==undefined && (!Array.isArray(o.dependsOn) || o.dependsOn.length>16 || !o.dependsOn.every(x=>typeof x==="string" && x.length<=150)))) throw err("Некорректные свойства стратегии");
    return {name:o.name.trim(),risk:o.risk!,reversible:o.reversible,dependsOn:o.dependsOn??[]};
  });
  const names=new Set(strategies.map(s=>s.name.toLocaleLowerCase("ru")));
  if(names.size!==strategies.length) throw err("Повторяющиеся стратегии");
  const completed = new Set(plan.steps.filter(x=>x.status==="done").map(x=>x.title.toLocaleLowerCase("ru")));
  const records=history.filter(x=>x.observed!==undefined && (payload.taskType===undefined || x.taskType===payload.taskType) && shares(x.goal,plan.goal));
  const graph=records.slice(-30).map(r=>({decisionId:r.id,goal:r.goal,strategy:r.chosen,outcome:r.observed!,observedAt:r.observedAt??r.at}));
  const assessed=strategies.map((s,index)=>{
    const relevant=records.filter(r=>r.chosen.trim().toLocaleLowerCase("ru")===s.name.toLocaleLowerCase("ru"));
    const successes=relevant.filter(r=>r.observed==="success").length;
    const failures=relevant.filter(r=>r.observed==="failure").length;
    const unresolved=s.dependsOn!.filter(d=>!completed.has(d.toLocaleLowerCase("ru")));
    const riskPenalty={low:0,medium:2,high:5}[s.risk]+(s.reversible?0:3);
    const evidenceScore=successes-failures;
    const score=evidenceScore-riskPenalty-(unresolved.length?5:0);
    return {name:s.name,originalIndex:index,score,risk:s.risk,reversible:s.reversible,successes,failures,
      sampleSize:relevant.length,insufficientEvidence:relevant.length<3,unresolvedDependencies:unresolved,
      blocked:unresolved.length>0,evidenceIds:relevant.map(r=>r.id),requiresOwnerApproval:true};
  }).sort((a,b)=>b.score-a.score || a.originalIndex-b.originalIndex);
  const failures=records.filter(r=>r.observed==="failure");
  const reflection={confirmedCases:records.length,confirmedFailures:failures.length,
    recurringFailureStrategies:[...new Set(failures.map(r=>r.chosen))].filter(name=>failures.filter(r=>r.chosen===name).length>=2).slice(0,10),
    unconfirmedExcluded:history.filter(r=>!r.observed).length};
  const next=plan.steps.find(x=>x.status!=="done");
  const evaluation={completedSteps:completed.size,totalSteps:plan.steps.length,evidenceCoverage:records.length,
    insufficientStrategies:assessed.filter(x=>x.insufficientEvidence).length,blockedStrategies:assessed.filter(x=>x.blocked).length};
  return {planId:plan.id,goal:plan.goal,strategies:assessed,memoryGraph:graph,reflection,evaluation,
    adaptivePlan:{nextStepId:next?.id??null,nextStepTitle:next?.title??null,
      suggestedStrategy:assessed[0]?.blocked?null:assessed[0]?.name??null,
      requiresOwnerApproval:true,executesAutomatically:false},
    requiresExplicitExecution:true,confidence:"heuristic" as const,
    note:"Оценки эвристические, факты подтверждены владельцем; изменение плана и исполнение не выполняются."};
}
