import type {EvolutionSnapshot} from "./kitsune-evolution-model";
import type {GrowthEvent} from "./kitsune-growth";
export type BranchTrack="update"|"fix"|"bug"|"paused";
export interface FoxBranch {id:string;track:BranchTrack;title:string;detail:string;version:string;source:string;status:"confirmed"|"planned";at:string}
export const BRANCH_TRACKS=[
 {id:"update",emoji:"🚀",title:"Ветки обновлений",subtitle:"Установленные версии и новые возможности"},
 {id:"fix",emoji:"🛠️",title:"Ветки правок",subtitle:"Подтверждённые изменения существующих ветвей"},
 {id:"bug",emoji:"🩹",title:"Ветки исправления ошибок",subtitle:"Известные неполадки и восстановление"},
 {id:"paused",emoji:"🧭",title:"На чём остановились",subtitle:"Не завершённые направления и последние шаги"}
] as const;
export function foxBranches(snapshot:EvolutionSnapshot|null,growth:GrowthEvent[]):FoxBranch[]{
 if(!snapshot)return [];
 const result:FoxBranch[]=[];
 const timeline=snapshot.timeline;
 for(const h of timeline.history){
  if(h.kind==="install")result.push({id:"install:"+h.id,track:"update",title:"Установка обновления",detail:h.message||"Подтверждённая установка",version:h.to,source:"SQLite · журнал установок",status:"confirmed",at:h.at});
  if(h.kind==="rollback")result.push({id:"rollback:"+h.id,track:"bug",title:"Восстановлена предыдущая версия",detail:h.message||"Откат по журналу",version:h.to,source:"SQLite · журнал откатов",status:"confirmed",at:h.at});
  if(h.kind==="failed"||h.kind==="startup_failed")result.push({id:"failed:"+h.id,track:"bug",title:"Проблема обновления",detail:h.message||"Неуспешная установка",version:h.to,source:"SQLite · журнал ошибок",status:"confirmed",at:h.at});
 }
 for(const item of growth){
  if(item.kind==="changed")result.push({id:"changed:"+item.id,track:"fix",title:item.title,detail:item.detail,version:timeline.activeVersion,source:"Сравнение сохранённых манифестов",status:"confirmed",at:""});
  if(item.kind==="new")result.push({id:"new:"+item.id,track:"update",title:item.title,detail:item.detail,version:timeline.activeVersion,source:"Сравнение сохранённых манифестов",status:"confirmed",at:""});
 }
 for(const node of snapshot.manifest.nodes.filter(n=>n.status==="planned")){
  const blockers=node.dependsOn.filter(id=>snapshot.manifest.nodes.find(n=>n.id===id)?.status!=="implemented");
  result.push({id:"planned:"+node.id,track:"paused",title:node.title,detail:blockers.length?"Ожидает зависимостей: "+blockers.join(", "):"Запланирована — реализация ещё не подтверждена",version:timeline.activeVersion,source:"Манифест развития",status:"planned",at:""});
 }
 return result.slice(0,350);
}
