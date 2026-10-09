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
  snapshot(){return this.records.map(r=>({...r}));}
  summary(){
    const confirmed=this.records.filter(r=>r.observed);
    const correct=confirmed.filter(r=>r.predictedSuccess===(r.observed==="success")).length;
    return {total:this.records.length,confirmed:confirmed.length,
      predictionAccuracy:confirmed.length?Math.round(100*correct/confirmed.length):null,
      note:"Это точность заявленных ожиданий по результатам, подтверждённым владельцем; не проверка независимым наблюдением."};
  }
}
