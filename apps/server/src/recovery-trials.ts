import { randomUUID } from "node:crypto";
import type { ToolObservation } from "./tool-failure-patterns";

export interface RecoveryTrial {
 id:string; tool:string; strategy:string; startedAt:string;
 baseline:{ok:number;error:number;denied:number}; after:{ok:number;error:number;denied:number};
 status:"collecting"|"completed"; window:3;
}
/** Only the owner can attest a proposed diagnostic strategy. No tool is called from here. */
export class RecoveryTrials {
 private trials:RecoveryTrial[]=[];
 snapshot(){return this.trials.map(x=>({...x,baseline:{...x.baseline},after:{...x.after}}));}
 load(input:unknown) {
  if(!Array.isArray(input))return;
  const validCounts=(x:any)=>x&&["ok","error","denied"].every(k=>Number.isInteger(x[k])&&x[k]>=0&&x[k]<=3);
  this.trials=input.filter((x):x is RecoveryTrial=>!!x&&typeof x==="object"&&typeof x.id==="string"&&x.id.length<=80&&
   /^[a-zA-Z0-9_-]{1,64}$/.test(x.tool)&&typeof x.strategy==="string"&&x.strategy.length>=8&&x.strategy.length<=500&&
   typeof x.startedAt==="string"&&!Number.isNaN(Date.parse(x.startedAt))&&x.window===3&&
   ["collecting","completed"].includes(x.status)&&validCounts(x.baseline)&&validCounts(x.after)&&
   x.baseline.ok+x.baseline.error+x.baseline.denied===3&&
   x.after.ok+x.after.error+x.after.denied<=(x.status==="completed"?3:2)).slice(-40);
 }
 create(tool:unknown,strategy:unknown,ownerConfirmed:unknown,observations:ToolObservation[]) {
  if(ownerConfirmed!==true)throw Object.assign(new Error("Требуется явное подтверждение владельца"),{status:403});
  if(typeof tool!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(tool)||
   typeof strategy!=="string"||strategy.trim().length<8||strategy.length>500)
   throw Object.assign(new Error("Некорректный план восстановления"),{status:400});
  if(this.trials.some(x=>x.tool===tool&&x.status==="collecting"))
   throw Object.assign(new Error("Проверка инструмента уже активна"),{status:409});
  const entries=observations.filter(x=>x.tool===tool).slice(0,3);
  if(entries.length!==3)throw Object.assign(new Error("Не хватает трёх исходных наблюдений"),{status:409});
  const tally=(a:ToolObservation[])=>({ok:a.filter(x=>x.status==="ok").length,error:a.filter(x=>x.status==="error").length,denied:a.filter(x=>x.status==="denied").length});
  const record:RecoveryTrial={id:randomUUID(),tool,strategy:strategy.trim(),startedAt:new Date().toISOString(),
   baseline:tally(entries),after:{ok:0,error:0,denied:0},status:"collecting",window:3};
  this.trials.push(record);this.trials=this.trials.slice(-40);
  return {...record,baseline:{...record.baseline},after:{...record.after}};
 }
 observe(event:{tool:string;status:"ok"|"error"|"denied"}) {
  const trial=this.trials.find(x=>x.tool===event.tool&&x.status==="collecting");
  if(!trial)return false;
  trial.after[event.status]++;
  if(trial.after.ok+trial.after.error+trial.after.denied>=3)trial.status="completed";
  return true;
 }
 report(){
  return {trials:this.snapshot().map(x=>({
   ...x,comparison:x.status!=="completed"?"insufficient":
    x.after.error<x.baseline.error?"fewer_errors":x.after.error>x.baseline.error?"more_errors":"same_errors"
  })),requiresOwnerConfirmation:true as const,
   note:"Это наблюдение до/после по три запуска. Причинность исправления и качество результата не подтверждены. Отказы владельца не приравниваются к ошибкам."};
 }
}
