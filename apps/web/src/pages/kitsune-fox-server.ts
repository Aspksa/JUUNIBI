import type {FoxMetric} from "./kitsune-fox-metrics";
import {sanitizeHistory,type FoxHistory} from "./kitsune-fox-history";
import {safeForestEvents,type ForestEvent} from "./kitsune-fox-life";
export interface FoxHour {hour:string;value:number}
export type FoxHourly=Record<string,FoxHour[]>;
export interface FoxServerRecord {daily:FoxHistory;hourly:FoxHourly;events:ForestEvent[];provenance:"client-observed"}
export function validateServerRecord(raw:unknown):FoxServerRecord|null{
 if(!raw||typeof raw!=="object")return null;
 const body=raw as Record<string,unknown>;
 if(body.schemaVersion!==1||body.durable!==true||body.provenance!=="client-observed")return null;
 const hourly:FoxHourly={};
 if(body.hourly&&typeof body.hourly==="object"&&!Array.isArray(body.hourly))
  for(const [id,points] of Object.entries(body.hourly)){
   if(!/^fox-(?:[0-9]|[1-9][0-9])$/.test(id)||!Array.isArray(points))continue;
   const valid:FoxHour[]=[];
   for(const point of points.slice(-24)){
    if(!point||typeof point!=="object")continue;
    const p=point as Partial<FoxHour>;
    if(typeof p.hour==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(p.hour)&&typeof p.value==="number"&&Number.isSafeInteger(p.value)&&p.value>=0)valid.push({hour:p.hour,value:p.value});
   }
   if(valid.length)hourly[id]=valid;
  }
 return {daily:sanitizeHistory(body.daily),hourly,events:safeForestEvents(body.events),provenance:"client-observed"};
}
export async function synchronizeFoxHistory(metrics:FoxMetric[],events:ForestEvent[]):Promise<FoxServerRecord|null>{
 const readings=metrics.filter(m=>m.value!==null&&Number.isSafeInteger(m.value)&&m.value>=0).map(m=>({id:m.id,value:m.value,source:m.source.slice(0,160)}));
 try{
  let response=await fetch("/api/kitsune/fox-history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"write",readings,events:events.slice(-20)})});
  if(response.status===403)response=await fetch("/api/kitsune/fox-history");
  if(!response.ok)return null;
  return validateServerRecord(await response.json() as unknown);
 }catch{return null;}
}
