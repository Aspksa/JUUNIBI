import { randomUUID } from "node:crypto";
/** Bounded, owner-attested decision outcomes; model suggestions never become observed facts automatically. */
export interface DecisionRecord {
  id: string; at: string; goal: string; chosen: string; reason: string;
  predictedSuccess: boolean; taskType?: string; observed?: "success" | "failure"; observedAt?: string;
}
const validText=(x:unknown,max:number):x is string=>typeof x==="string" && x.trim().length>0 && x.length<=max;
export class DecisionMemory {
  private records:DecisionRecord[]=[];
  load(input:unknown) {
    if (!Array.isArray(input)) return;
    this.records=input.filter((r):r is DecisionRecord=>!!r && typeof r==="object" &&
      validText(r.id,80) && validText(r.at,60) && validText(r.goal,500) &&
      validText(r.chosen,100) && validText(r.reason,1000) && (r.taskType===undefined || validText(r.taskType,60)) && typeof r.predictedSuccess==="boolean" &&
      (r.observed===undefined || r.observed==="success" || r.observed==="failure") &&
      (r.observedAt===undefined || validText(r.observedAt,60))).slice(-100);
  }
  record(input:{goal:string;chosen:string;reason:string;predictedSuccess:boolean;taskType?:string}) {
    if (!validText(input?.goal,500) || !validText(input?.chosen,100) ||
      !validText(input?.reason,1000) || (input.taskType!==undefined && !validText(input.taskType,60)) || typeof input.predictedSuccess!=="boolean")
      throw Object.assign(new Error("Некорректное решение"),{status:400});
    const item:DecisionRecord={...input,id:randomUUID(),at:new Date().toISOString()};
    this.records.push(item);this.records=this.records.slice(-100);
    return {...item};
  }
  confirm(id:string,observed:"success"|"failure") {
    const item=this.records.find(r=>r.id===id);
    if(!item) throw Object.assign(new Error("Решение не найдено"),{status:404});
    if(observed!=="success" && observed!=="failure") throw Object.assign(new Error("Недопустимый результат"),{status:400});
    if(item.observed) throw Object.assign(new Error("Результат уже зафиксирован"),{status:409});
    item.observed=observed;item.observedAt=new Date().toISOString();
    return {...item};
  }
  /** Hybrid lexical + task-type + confirmation recency retrieval; no embeddings required. */
  searchConfirmed(query: unknown, taskType?: unknown, limit: unknown = 5) {
    if (typeof query !== "string" || !query.trim() || query.length > 500 ||
        (taskType !== undefined && !validText(taskType,60)) ||
        !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 20)
      throw Object.assign(new Error("Некорректный поиск опыта"), {status:400});
    const tokenize = (text:string) => new Set((text.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{2,}/gu) ?? []));
    const terms = tokenize(query);
    const candidates = this.records.filter(r => r.observed !== undefined).map(r => {
      const words = tokenize(r.goal + " " + r.chosen + " " + r.reason);
      const matched = [...terms].filter(word => words.has(word)).length;
      const taskMatch = taskType !== undefined && r.taskType === taskType;
      const score = matched * 3 + (taskMatch ? 4 : 0);
      return {record:r,score,matched};
    }).filter(item => item.score > 0)
      .sort((a,b) => b.score-a.score || (b.record.observedAt ?? b.record.at).localeCompare(a.record.observedAt ?? a.record.at) || a.record.id.localeCompare(b.record.id))
      .slice(0,limit as number);
    return {items:candidates.map(({record,score,matched}) => ({...record,score,matchedTerms:matched})),
      totalConfirmed:this.records.filter(r=>r.observed!==undefined).length,
      source:"owner-confirmed-decisions" as const,
      note:"Лексический поиск с учётом типа задачи; подтверждение владельца не гарантирует истинность вывода."};
  }
  snapshot(){return this.records.map(r=>({...r}));}
  summary(){
    const confirmed=this.records.filter(r=>r.observed);
    const correct=confirmed.filter(r=>r.predictedSuccess===(r.observed==="success")).length;
    return {total:this.records.length,confirmed:confirmed.length,
      predictionAccuracy:confirmed.length?Math.round(100*correct/confirmed.length):null,
      note:"Это точность заявленных ожиданий по результатам, подтверждённым владельцем; не проверка независимым наблюдением."};
  }
}
