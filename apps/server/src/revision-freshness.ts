import type { RevisionEntry } from "./revision-history";

export interface FreshEvidence { id:string; claimId:string; supports:boolean; verified:boolean; observedAt:string }
export interface FreshnessRequest { claimId:string; proposed:boolean; now:string; maxAgeDays:number; evidence:FreshEvidence[] }
const error=():never=>{throw Object.assign(new Error("Некорректные данные проверки актуальности"),{status:400});};
const parse=(s:string)=>{const v=Date.parse(s);return Number.isFinite(v)?v:NaN;};
/** Explain evidence age and past decisions; never silently overturn a prior rejection. */
export function assessRevisionFreshness(input:FreshnessRequest,history:RevisionEntry[]) {
 if(!input||typeof input.claimId!=="string"||!/^[\w-]{1,80}$/.test(input.claimId)||
 typeof input.proposed!=="boolean"||typeof input.now!=="string"||!Number.isFinite(parse(input.now))||
 !Number.isInteger(input.maxAgeDays)||input.maxAgeDays<1||input.maxAgeDays>3650||
 !Array.isArray(input.evidence)||input.evidence.length>60||
 input.evidence.some(e=>!e||typeof e.id!=="string"||!/^[\w-]{1,80}$/.test(e.id)||
 e.claimId!==input.claimId||typeof e.supports!=="boolean"||typeof e.verified!=="boolean"||
 typeof e.observedAt!=="string"||!Number.isFinite(parse(e.observedAt)))||
 new Set(input.evidence.map(e=>e.id)).size!==input.evidence.length)error();
 const now=parse(input.now),ageLimit=input.maxAgeDays*86400000;
 const reports=input.evidence.map(e=>{const ageMs=now-parse(e.observedAt);
 return {id:e.id,supports:e.supports,verified:e.verified,fresh:e.verified&&ageMs>=0&&ageMs<=ageLimit,
 reason:!e.verified?"Источник не подтверждён":ageMs<0?"Дата источника в будущем":ageMs>ageLimit?"Сведения устарели":"Актуальное подтверждение"};});
 const fresh=reports.filter(e=>e.fresh),positive=fresh.filter(e=>e.supports).length,negative=fresh.length-positive;
 const rejected=(Array.isArray(history)?history:[]).filter(r=>r.claimId===input.claimId&&r.proposed===input.proposed&&r.outcome==="rejected");
 const latestRejected=rejected.at(-1);
 const newSinceRejection=latestRejected?input.evidence.some(e=>parse(e.observedAt)>parse(latestRejected.at)&&reports.some(x=>x.id===e.id&&x.fresh)):false;
 return {claimId:input.claimId,positive,negative,stale:reports.filter(e=>e.verified&&!e.fresh).length,
 evidence:reports,previouslyRejected:rejected.length>0,newSinceRejection,
 recommendation:positive===negative?"Недостаточно оснований для изменения":
 positive>negative&&!newSinceRejection&&rejected.length?"Повторное предложение без новых подтверждений; требуется проверка":
 positive>negative?"Проверить изменение вывода с владельцем":"Противоречащие сведения требуют дополнительной проверки",
 requiresApproval:true as const,
 note:"Проверяется возраст и переданный статус источников, но не их независимая достоверность."};
}
