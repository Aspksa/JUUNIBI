import type { ToolObservation } from "./tool-failure-patterns";
import type { DecisionRecord } from "./decision-memory";

/** Thirteen read-only learning signals. Neither metadata nor model predictions are verified outcomes. */
export function analyzeExperience(observations: ToolObservation[], decisions: DecisionRecord[]) {
 if (!Array.isArray(observations) || observations.length > 100 || !Array.isArray(decisions) || decisions.length > 100)
   throw Object.assign(new Error("Некорректная история обучения"), {status:400});
 const tools = observations.filter(x => x && /^[a-zA-Z0-9_-]{1,64}$/.test(x.tool) &&
   ["ok","error","denied"].includes(x.status) && ["read","write","danger"].includes(x.risk) &&
   Number.isFinite(x.elapsedMs) && x.elapsedMs>=0 && x.elapsedMs<=3600000);
 const confirmed = decisions.filter(x=>x && (x.observed==="success" || x.observed==="failure"));
 const count=(a:ToolObservation[],s:ToolObservation["status"])=>a.filter(x=>x.status===s).length;
 const rate=(ok:number,total:number)=>total ? Math.round(100*ok/total) : null;
 const byTool=Object.entries(Object.groupBy(tools,x=>x.tool)).map(([name,rows])=>{
   const a=rows ?? [];const errors=count(a,"error"),denials=count(a,"denied"),successes=count(a,"ok");
   return {name,attempts:a.length,successes,errors,denials,successRate:rate(successes,a.length),
    recurringErrors:errors>=2,lastObservedAt:a.reduce((m,x)=>x.at>m?x.at:m,""),
    meanElapsedMs:Math.round(a.reduce((n,x)=>n+x.elapsedMs,0)/a.length)};
 }).sort((a,b)=>b.errors-a.errors||a.name.localeCompare(b.name));
 const groups=Object.entries(Object.groupBy(confirmed,x=>x.taskType||"без категории")).map(([name,items])=>{
   const rows=items??[];const success=rows.filter(x=>x.observed==="success").length;
   return {name,confirmed:rows.length,successRate:rate(success,rows.length)};
 }).sort((a,b)=>b.confirmed-a.confirmed||a.name.localeCompare(b.name));
 const warnings:string[]=[];
 if (tools.length<10) warnings.push("Мало наблюдений инструментов: нельзя судить о надёжности.");
 if (confirmed.length<5) warnings.push("Мало подтверждённых результатов решений: прогнозы ненадёжны.");
 if (tools.some(x=>x.status==="denied")) warnings.push("Отказы в доступе не являются техническими ошибками и не подлежат обходу.");
 const decisionCorrect=confirmed.filter(x=>x.predictedSuccess===(x.observed==="success")).length;
 const recently=tools.slice(0,20),older=tools.slice(20,40);
 const recentRate=rate(count(recently,"ok"),recently.length);
 const previousRate=rate(count(older,"ok"),older.length);
 const signals=[
   {id:"tool_samples",value:tools.length},
   {id:"tool_success_rate",value:rate(count(tools,"ok"),tools.length)},
   {id:"tool_errors",value:count(tools,"error")},
   {id:"tool_denials",value:count(tools,"denied")},
   {id:"recurring_error_tools",value:byTool.filter(x=>x.recurringErrors).length},
   {id:"tool_duration_ms",value:tools.length?Math.round(tools.reduce((n,x)=>n+x.elapsedMs,0)/tools.length):null},
   {id:"high_risk_calls",value:tools.filter(x=>x.risk==="danger").length},
   {id:"write_calls",value:tools.filter(x=>x.risk==="write").length},
   {id:"confirmed_decisions",value:confirmed.length},
   {id:"decision_prediction_accuracy",value:rate(decisionCorrect,confirmed.length)},
   {id:"decision_success_rate",value:rate(confirmed.filter(x=>x.observed==="success").length,confirmed.length)},
   {id:"recent_tool_success_rate",value:recentRate},
   {id:"tool_success_trend_points",value:recentRate===null||previousRate===null?null:recentRate-previousRate}
 ] as const;
 return {signals,byTool,decisionGroups:groups,warnings,advisoryOnly:true as const,
  requiresOwnerConfirmation:true as const,
  note:"13 показателей описывают наблюдения инструментов и подтверждённые владельцем решения. Они не доказывают обучение модели, не дают новых разрешений и не изменяют инструменты."};
}
