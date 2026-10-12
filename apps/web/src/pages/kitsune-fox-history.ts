import type {FoxMetric} from "./kitsune-fox-metrics";
export interface FoxPoint {day:string;value:number}
export type FoxHistory=Record<string,FoxPoint[]>;
const KEY="juunibi:fox:history:v1";
export function sanitizeHistory(raw:unknown):FoxHistory{
 const output:FoxHistory={};
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return output;
 for(const [key,value] of Object.entries(raw)){
  if(!key.startsWith("fox-")||!Array.isArray(value))continue;
  const points:FoxPoint[]=[];
  for(const item of value){
   if(!item||typeof item!=="object")continue;
   const point=item as Partial<FoxPoint>;
   if(typeof point.day==="string"&&point.day.length===10&&typeof point.value==="number"&&Number.isSafeInteger(point.value)&&point.value>=0)points.push({day:point.day,value:point.value});
  }
  if(points.length)output[key]=points.slice(-30);
 }
 return output;
}
export function recordMetrics(history:FoxHistory,metrics:FoxMetric[],day:string):FoxHistory{
 const result={...history};
 for(const metric of metrics){
  const value=metric.value;
  if(value===null||!Number.isSafeInteger(value)||value<0)continue;
  const points=(result[metric.id]??[]).filter(p=>p.day!==day);
  result[metric.id]=[...points,{day,value}].sort((a,b)=>a.day.localeCompare(b.day)).slice(-30);
 }
 return result;
}
export function metricDelta(points:FoxPoint[],days:7|30):number|null{
 if(points.length<2)return null;
 const last=points[points.length-1]!;
 const cutoff=Date.parse(last.day+"T00:00:00Z")-(days-1)*86400000;
 const prior=points.find(x=>x.day<last.day&&Date.parse(x.day+"T00:00:00Z")>=cutoff);
 return prior?last.value-prior.value:null;
}
export function readHistory():FoxHistory{
 try{return sanitizeHistory(JSON.parse(localStorage.getItem(KEY)??"null") as unknown);}catch{return {};}
}
export function saveHistory(data:FoxHistory):void{
 try{localStorage.setItem(KEY,JSON.stringify(data));}catch{/* Storage is optional. */}
}
export function forestMood(metrics:FoxMetric[]):{emoji:string;label:string;detail:string}{
 const get=(id:number)=>metrics[id]?.value;
 if((get(12)??0)>0||(get(54)??0)>0)return {emoji:"🩹",label:"Лес просит помощи",detail:"Получен сигнал об ошибке."};
 if((get(24)??0)>0||(get(44)??0)>0)return {emoji:"🦊",label:"Лисички трудятся",detail:"Есть активные операции."};
 if(metrics.some(m=>m.value!==null))return {emoji:"🌿",label:"Лес наблюдает",detail:"Статистика получена из модулей."};
 return {emoji:"🌙",label:"Лес ждёт новостей",detail:"Подтверждённых значений пока нет."};
}
