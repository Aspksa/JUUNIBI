/** Read-only diagnosis over bounded metadata, not independently verified root causes. */
export interface ToolObservation {tool:string;status:"ok"|"error"|"denied";risk:"read"|"write"|"danger";elapsedMs:number;at:string}
export function analyzeToolFailures(observations:ToolObservation[]) {
 if (!Array.isArray(observations)||observations.length>100) throw Object.assign(new Error("Некорректный журнал инструментов"),{status:400});
 const byTool=new Map<string,{tool:string;total:number;errors:number;denials:number;successes:number;lastFailureAt:string|null;totalMs:number}>();
 for(const item of observations){
  if(!item||typeof item.tool!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(item.tool)||!["ok","error","denied"].includes(item.status)||
   !["read","write","danger"].includes(item.risk)||!Number.isFinite(item.elapsedMs)||item.elapsedMs<0||item.elapsedMs>3600000||
   typeof item.at!=="string"||Number.isNaN(Date.parse(item.at)))
   throw Object.assign(new Error("Некорректная запись инструмента"),{status:400});
  let group=byTool.get(item.tool);
  if(!group){group={tool:item.tool,total:0,errors:0,denials:0,successes:0,lastFailureAt:null,totalMs:0};byTool.set(item.tool,group);}
  group.total++;group.totalMs+=item.elapsedMs;
  if(item.status==="error")group.errors++;
  else if(item.status==="denied")group.denials++;
  else group.successes++;
  if(item.status!=="ok"&&(!group.lastFailureAt||item.at>group.lastFailureAt))group.lastFailureAt=item.at;
 }
 const patterns=[...byTool.values()].map(({totalMs,...g})=>({
  ...g,failureRate:Math.round((g.errors+g.denials)*100/g.total),
  averageElapsedMs:Math.round(totalMs/g.total),
  recurring:g.errors>=2,
  recommendation:g.errors>=2?"Перепроверить входные условия и доступность инструмента; повторять только с подтверждением при необходимости":
   g.denials>=2?"Проверить причины отказов и полномочия, не обходя механизм подтверждения":
   g.errors===1?"Исследовать единичную ошибку до повторного запуска":"Сбоев исполнения в журнале не выявлено",
 })).sort((a,b)=>Number(b.recurring)-Number(a.recurring)||b.errors-a.errors||b.denials-a.denials||a.tool.localeCompare(b.tool));
 return {sampleSize:observations.length,patterns,requiresApproval:true as const,
 note:"Ошибки и отказы различаются. Выводы основаны только на последних 100 метаданных и не доказывают причину сбоя; действия не выполняются."};
}
