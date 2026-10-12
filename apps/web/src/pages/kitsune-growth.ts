import type {EvolutionNode, EvolutionSnapshot} from "./kitsune-evolution-model";
export type GrowthKind="new"|"changed"|"removed"|"rollback"|"installed";
export interface GrowthEvent {id:string;kind:GrowthKind;title:string;detail:string;nodeId?:string}
/** Prefer durable versioned manifests; never derive confirmed features from release titles. */
export function growthEvents(snapshot:EvolutionSnapshot):GrowthEvent[]{
 const history=snapshot.timeline.history;
 const versions=snapshot.timeline.snapshots??[];
 const active=snapshot.timeline.activeVersion;
 const current=versions.find(v=>v.version===active);
 const preceding=history.find(h=>h.to===active&&(h.kind==="install"||h.kind==="rollback"));
 const previous=preceding?versions.find(v=>v.version===preceding.from):undefined;
 const results:GrowthEvent[]=[];
 if(preceding)results.push({id:"update:"+preceding.id,kind:preceding.kind==="rollback"?"rollback":"installed",
   title:preceding.kind==="rollback"?"Восстановлена предыдущая версия":"Обновление установлено",
   detail:active.slice(0,12)});
 if(!previous||!current||previous.version===current.version)return results;
 const old=new Map<string,EvolutionNode>(previous.manifest.nodes.map(n=>[n.id,n]));
 const next=new Map<string,EvolutionNode>(current.manifest.nodes.map(n=>[n.id,n]));
 for(const n of current.manifest.nodes){
   const before=old.get(n.id);
   if(!before)results.push({id:"new:"+n.id,kind:"new",title:n.title,detail:"Новая подтверждённая ветвь",nodeId:n.id});
   else if(JSON.stringify(before)!==JSON.stringify(n))results.push({id:"changed:"+n.id,kind:"changed",title:n.title,detail:"Изменены свойства ветви",nodeId:n.id});
 }
 for(const n of previous.manifest.nodes)if(!next.has(n.id))
  results.push({id:"removed:"+n.id,kind:"removed",title:n.title,detail:"Ветвь отсутствует в новом манифесте"});
 return results.slice(0,80);
}
export function growthTone(kind:GrowthKind):"positive"|"warning"|"neutral"{
 return kind==="new"?"positive":kind==="removed"||kind==="rollback"?"warning":"neutral";
}
