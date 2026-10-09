import { assessKnowledgeImpact, type KnowledgeNode } from "./knowledge-impact";

export interface RecheckPriority { id:string; importance:number; evidenceAgeDays:number; confirmed:boolean }
export function planKnowledgeRecheck(nodes:KnowledgeNode[],changedId:string,priorities:RecheckPriority[]) {
 const impact=assessKnowledgeImpact(nodes,changedId);
 if(!Array.isArray(priorities)||priorities.length>100||
 priorities.some(p=>!p||typeof p.id!=="string"||!/^[a-zA-Z0-9_-]{1,60}$/.test(p.id)||
 !Number.isInteger(p.importance)||p.importance<1||p.importance>5||
 !Number.isFinite(p.evidenceAgeDays)||p.evidenceAgeDays<0||p.evidenceAgeDays>36500||
 typeof p.confirmed!=="boolean")||new Set(priorities.map(p=>p.id)).size!==priorities.length||
 priorities.some(p=>!nodes.some(n=>n.id===p.id)))
 throw Object.assign(new Error("Некорректные приоритеты проверки"),{status:400});
 const byId=new Map(priorities.map(p=>[p.id,p]));
 const affected=[{id:changedId,depth:0},...impact.impacted];
 const tasks=affected.map(item=>{
  const p=byId.get(item.id);
  const priority=p?.importance??3;
  const age=p?.evidenceAgeDays??0;
  const unconfirmed=p?.confirmed===false;
  const score=priority*20 + Math.min(30,Math.floor(age/30)) + (unconfirmed?20:0) + Math.max(0,10-item.depth*2);
  return {id:item.id,depth:item.depth,score,importance:priority,action:"recheck" as const,
   reason:unconfirmed?"Нет подтверждения исходных сведений":age>365?"Сведения могут устареть":"Проверить зависимость от изменённого знания"};
 }).sort((a,b)=>b.score-a.score||a.depth-b.depth||a.id.localeCompare(b.id));
 return {changedId,tasks,conflicts:impact.contradictions,requiresApproval:true as const,
  note:"Приоритеты являются прозрачной эвристикой. План не обновляет знания и требует подтверждения."};
}
