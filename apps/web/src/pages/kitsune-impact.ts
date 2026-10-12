import type {EvolutionNode} from "./kitsune-evolution-model";
export interface Impact {id:string;title:string;distance:number;status:EvolutionNode["status"]}
export function downstreamImpact(nodes:EvolutionNode[],id:string):Impact[]{
 const levels=new Map<string,number>([[id,0]]);const queue=[id];
 for(let i=0;i<queue.length;i++){const current=queue[i]!;const depth=levels.get(current)!;
  for(const node of nodes)if(node.dependsOn.includes(current)&&!levels.has(node.id)){
   levels.set(node.id,depth+1);queue.push(node.id);
  }
 }
 return nodes.filter(n=>n.id!==id&&levels.has(n.id)).map(n=>({id:n.id,title:n.title,distance:levels.get(n.id)!,status:n.status}))
  .sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
}
export interface VersionDiff {added:string[];removed:string[];unchanged:string[];uncertain:string[]}
/** Exact revisions require versioned manifests; a release title alone is never proof of capability presence. */
export function compareManifests(before:EvolutionNode[],after:EvolutionNode[]):VersionDiff{
 const old=new Map(before.map(n=>[n.id,n])),next=new Map(after.map(n=>[n.id,n]));
 return {added:after.filter(n=>!old.has(n.id)).map(n=>n.title),
 removed:before.filter(n=>!next.has(n.id)).map(n=>n.title),
 unchanged:after.filter(n=>old.has(n.id)&&JSON.stringify(old.get(n.id))===JSON.stringify(n)).map(n=>n.title),
 uncertain:after.filter(n=>old.has(n.id)&&JSON.stringify(old.get(n.id))!==JSON.stringify(n)).map(n=>n.title)};
}
export function architectureQuestion(nodes:EvolutionNode[],id:string,question:string):string{
 const n=nodes.find(n=>n.id===id);if(!n)throw new Error("Неизвестная ветвь");
 const related=downstreamImpact(nodes,id).slice(0,30);
 return ["Ты — консультант по архитектуре JUUNIBI. Анализируй, но не выполняй изменений.",
 "Контекст из манифеста (не считать фактом установленной версии):",
 "Ветка: "+n.title,"Назначение: "+n.description,"Работа: "+n.how,
 "Зависимости: "+n.dependsOn.join(", "),"Затрагивает ветви: "+related.map(x=>x.title).join(", "),
 "Вопрос владельца: "+question.slice(0,2500),
 "Отдели подтверждённые зависимости от предположений. Предложи план, риски и тесты. Никаких действий без разрешения."].join("\n");
}
