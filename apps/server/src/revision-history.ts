import { randomUUID } from "node:crypto";
export interface RevisionEntry {id:string;claimId:string;previous:boolean;proposed:boolean;reason:string;at:string;outcome?:"accepted"|"rejected"}
const valid=(s:unknown,max:number):s is string=>typeof s==="string" && s.trim().length>0 && s.length<=max;
export class RevisionHistory {
 private entries:RevisionEntry[]=[];
 load(value:unknown){if(!Array.isArray(value))return;this.entries=value.filter((r):r is RevisionEntry=>!!r&&typeof r==="object"&&valid(r.id,80)&&valid(r.claimId,80)&&typeof r.previous==="boolean"&&typeof r.proposed==="boolean"&&r.previous!==r.proposed&&valid(r.reason,500)&&valid(r.at,60)&&(r.outcome===undefined||r.outcome==="accepted"||r.outcome==="rejected")).slice(-100);}
 add(input:{claimId:string;previous:boolean;proposed:boolean;reason:string}){
  if(!valid(input?.claimId,80)||typeof input.previous!=="boolean"||typeof input.proposed!=="boolean"||input.previous===input.proposed||!valid(input.reason,500))throw Object.assign(new Error("Некорректная запись пересмотра"),{status:400});
  const record:RevisionEntry={...input,id:randomUUID(),at:new Date().toISOString()};this.entries.push(record);this.entries=this.entries.slice(-100);return {...record};
 }
 resolve(id:string,outcome:"accepted"|"rejected"){const r=this.entries.find(e=>e.id===id);if(!r)throw Object.assign(new Error("Пересмотр не найден"),{status:404});if(outcome!=="accepted"&&outcome!=="rejected")throw Object.assign(new Error("Некорректное решение"),{status:400});if(r.outcome)throw Object.assign(new Error("Решение уже подтверждено"),{status:409});r.outcome=outcome;return {...r};}
 snapshot(){return this.entries.map(e=>({...e}));}
 warnings(claimId:string,proposed:boolean){return this.entries.filter(e=>e.claimId===claimId&&e.proposed===proposed&&e.outcome==="rejected").map(e=>({revisionId:e.id,reason:"Ранее аналогичный пересмотр был отклонён: "+e.reason}));}
}
