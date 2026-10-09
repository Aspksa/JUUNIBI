import type { DecisionRecord } from "./decision-memory";
const terms=(s:string)=>new Set((s.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g,"е").match(/[\p{L}\p{N}]{4,}/gu)??[]));
/** Read-only recall. Only owner-confirmed observations qualify as evidence. */
export function recallConfirmedExperience(records: readonly DecisionRecord[], query:string, limit=3) {
 if(typeof query!=="string"||query.length>100000)return [];
 const q=terms(query);
 if(!q.size)return [];
 return records.filter(x=>x.observed==="success"||x.observed==="failure").map(x=>{
  const overlap=[...q].filter(w=>terms(x.goal+" "+(x.taskType??"")).has(w)).length;
  return {record:x,overlap};
 }).filter(x=>x.overlap>0)
 .sort((a,b)=>b.overlap-a.overlap||b.record.at.localeCompare(a.record.at))
 .slice(0,Math.max(1,Math.min(5,limit)))
 .map(({record,overlap})=>({id:record.id,goal:record.goal.slice(0,220),
  chosen:record.chosen.slice(0,100),observed:record.observed!,observedAt:record.observedAt??record.at,overlap,
  evidence:"owner-confirmed" as const}));
}
export function evaluateExperienceRecall(records:readonly DecisionRecord[],queries:readonly {query:string;expectedId:string}[]) {
 const bounded=queries.slice(0,50);
 const found=bounded.filter(x=>recallConfirmedExperience(records,x.query)[0]?.id===x.expectedId).length;
 return {tested:bounded.length,top1Matched:found,accuracy:bounded.length?found/bounded.length:null,
  note:"Метрика точности поиска на заданных примерах, не улучшение качества ответа."};
}
