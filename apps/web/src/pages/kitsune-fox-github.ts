/** Public GitHub PR ledger. Network data is advisory and never treated as an installed version. */
export interface FoxPull {number:number;title:string;url:string;createdAt:string;mergedAt:string|null;state:"open"|"closed"|"merged";sha:string;ci:"passed"|"failed"|"pending"|"unknown"}
export function parseFoxPulls(raw:unknown):FoxPull[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(0,40).flatMap((value):FoxPull[]=>{
  if(!value||typeof value!=="object")return [];
  const p=value as Record<string,unknown>;
  const number=p.number, title=p.title,html=p.html_url,head=p.head as {sha?:unknown}|undefined;
  if(typeof number!=="number"||!Number.isSafeInteger(number)||number<1||typeof title!=="string"||typeof html!=="string"||
    !/^https:\/\/github\.com\/Aspksa\/JUUNIBI\/pull\/\d+$/.test(html))return [];
  const mergedAt=typeof p.merged_at==="string"?p.merged_at:null;
  const state=mergedAt?"merged":p.state==="open"?"open":"closed";
  return [{number,title:title.slice(0,170),url:html,createdAt:typeof p.created_at==="string"?p.created_at:"",mergedAt,
    state,sha:typeof head?.sha==="string"&&/^[0-9a-f]{40}$/.test(head.sha)?head.sha:"",ci:"unknown"}];
 });
}
export function foxPullTrack(pr:FoxPull):"update"|"fix"|"bug"|"paused"{
 if(pr.state==="open")return "paused";
 if(/\b(fix|bug|crash|repair|regression|rollback|hotfix)\b|исправ|ошиб|сбо[йя]/i.test(pr.title))return "bug";
 if(/\b(refactor|style|cleanup|polish|adjust|patch|perf)\b|правк|доработ|оптимиз/i.test(pr.title))return "fix";
 return "update";
}
export function parseFoxCI(raw:unknown):FoxPull["ci"]{
 if(!raw||typeof raw!=="object")return "unknown";
 const runs=(raw as {workflow_runs?:unknown}).workflow_runs;
 if(!Array.isArray(runs)||!runs.length)return "unknown";
 const latest=runs.filter(x=>x&&typeof x==="object").sort((a,b)=>String((b as {created_at?:string}).created_at??"").localeCompare(String((a as {created_at?:string}).created_at??"")))[0] as {status?:string;conclusion?:string}|undefined;
 return latest?.status!=="completed"?"pending":latest.conclusion==="success"?"passed":latest.conclusion==="failure"?"failed":"unknown";
}
export async function getFoxPulls():Promise<FoxPull[]|null>{
 try{
  const controller=new AbortController();
  const t=setTimeout(()=>controller.abort(),8500);
  let response:Response;
  try{response=await fetch("https://api.github.com/repos/Aspksa/JUUNIBI/pulls?state=all&per_page=30",{headers:{Accept:"application/vnd.github+json"},signal:controller.signal});}
  finally{clearTimeout(t);}
  if(!response.ok)return null;
  return parseFoxPulls(await response.json() as unknown);
 }catch{return null;}
}
export async function refreshFoxChecks(pulls:FoxPull[]):Promise<FoxPull[]>{
 const matched=pulls.filter(p=>p.sha&&(p.state==="merged"||p.state==="open")).slice(0,6);
 const entries=await Promise.all(matched.map(async p=>{
  try{
   const response=await fetch("https://api.github.com/repos/Aspksa/JUUNIBI/actions/runs?head_sha="+encodeURIComponent(p.sha)+"&per_page=5",{headers:{Accept:"application/vnd.github+json"}});
   return [p.number,response.ok?parseFoxCI(await response.json() as unknown):"unknown"] as const;
  }catch{return [p.number,"unknown"] as const;}
 }));
 const map=new Map(entries);
 return pulls.map(p=>({...p,ci:map.get(p.number)??p.ci}));
}
