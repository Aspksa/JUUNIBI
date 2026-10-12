import type {EvolutionNode} from "./kitsune-evolution-model";
export interface CapabilityOrigin {sha:string;pr:number}
export interface TracedCapability {id:string;title:string;origin:CapabilityOrigin|null;installation:"current"|"recorded"|"unverified";historyCount:number}
/** A merge SHA is evidence of code provenance, NOT proof that it was installed. */
export function traceCapabilities(nodes:EvolutionNode[],activeVersion:string,history:{from:string;to:string;kind:string}[]):TracedCapability[]{
 return nodes.map(node=>{
  const origin=node.introducedIn??null;
  const versions=new Set(history.filter(h=>h.kind==="install"||h.kind==="rollback").flatMap(h=>[h.from,h.to]));
  return {id:node.id,title:node.title,origin,
    installation:origin?.sha===activeVersion?"current":origin&&versions.has(origin.sha)?"recorded":"unverified",
    historyCount:origin?history.filter(h=>h.to===origin.sha).length:0};
 });
}
export interface EvolutionHistoryEvent {id:string;at:string;kind:string;description:string;version:string}
export function evolutionChronology(history:{id:string;at:string;kind:string;to:string;message:string}[]):EvolutionHistoryEvent[]{
 return [...history].sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id)).map(h=>({
  id:h.id,at:h.at,kind:h.kind,version:h.to,description:h.message||(
    h.kind==="rollback"?"Откат на предыдущую версию":h.kind==="install"?"Установка обновления":"Сбой обновления")
 }));
}
export function architecturePrompt(node:EvolutionNode, nodes:EvolutionNode[]):string {
 const references=nodes.filter(n=>node.dependsOn.includes(n.id));
 return ["Проанализируй развитие JUUNIBI. Ничего не изменяй без моего подтверждения.",
   "Целевая ветка: "+node.title,"Цель: "+node.description,
   "Как работает сейчас/планируется: "+node.how,
   "Зависимости: "+(references.map(n=>n.title+" ("+n.status+")").join(", ")||"не указаны"),
   "Предложи архитектуру, риски, тесты, критерии готовности и независимые этапы реализации.",
   "Отличай подтверждённые данные от гипотез. Не считай наличие PR доказательством локальной установки."].join("\n");
}
