import type {UpdateStatus,UpdateHistory} from "../api";
import type {EvolutionNode} from "./kitsune-evolution-model";

export type EvolutionReleaseState="available"|"downloading"|"verified"|"installed"|"rolled-back"|"failed";
export interface EvolutionRelease {
 id:string; title:string; version:string; description:string; state:EvolutionReleaseState;
 date:string; relatedBranches:string[]; evidence:string|null;
 /** Откуда известна связь с ветвями: из сохранённых снимков архитектуры (точно) или из описания (предположительно). */
 branchSource:"snapshots"|"description"|"none";
}
const titleOf=(version:string)=>"Обновление "+version.slice(0,12);
const inferBranches=(text:string):string[]=>{
 const patterns:[RegExp,string][]=[
  [/brain|мозг|памят|memory|strategy|search|intelligen/i,"brain"],
  [/task|дела|достижен|achievement/i,"tasks"],
  [/disk|диск|file|файл/i,"disk"],
  [/agent|агент/i,"agent"],
  [/kitsune|древо|evolution/i,"core"]
 ];
 return patterns.filter(([rx])=>rx.test(text)).map(([,id])=>id);
};
/** Projection of updater's persistent status and history. No release becomes installed on download alone. */
export interface SnapshotLike{version:string;manifest:{nodes:EvolutionNode[]}}
/** Ветви, которые появились или изменились между двумя сохранёнными снимками. Нет обоих снимков — null: ничего не угадываем. */
export function branchesFromSnapshots(snapshots:SnapshotLike[]|undefined,from:string,to:string):string[]|null{
 const before=snapshots?.find(x=>x.version===from),after=snapshots?.find(x=>x.version===to);
 if(!before||!after)return null;
 const old=new Map(before.manifest.nodes.map(n=>[n.id,JSON.stringify(n)]));
 return after.manifest.nodes.filter(n=>old.get(n.id)!==JSON.stringify(n)).map(n=>n.id);
}
const linked=(text:string,exact:string[]|null):{ids:string[];source:EvolutionRelease["branchSource"]}=>{
 if(exact)return {ids:exact,source:"snapshots"};
 const guess=inferBranches(text);
 return {ids:guess,source:guess.length?"description":"none"};
};
export function evolutionFromUpdater(status:UpdateStatus|null,history:UpdateHistory|null,snapshots?:SnapshotLike[]):EvolutionRelease[]{
 const result:EvolutionRelease[]=[];
 const local=status?.localVersion??"";
 const items=history?.items??[];
 const rolledBack=new Set(items.filter(h=>h.kind==="rollback").map(h=>h.from));
 for(const item of items){
   if(item.kind==="failed"||item.kind==="startup_failed"){
     // A version that did not install or did not start: shown, never counted as installed.
     result.push({id:"history:"+item.id,title:item.kind==="failed"?"Установка не удалась":"Версия не запустилась",version:item.to,
       description:item.message||(item.kind==="failed"?"Установка прервана, изменения откатаны":"Новая версия не запустилась, возвращена прежняя"),
       date:item.at,state:"failed",relatedBranches:inferBranches(item.message??""),branchSource:inferBranches(item.message??"").length?"description":"none",evidence:null});
     continue;
   }
   if(item.kind!=="install"&&item.kind!=="rollback")continue;
   const state:EvolutionReleaseState=item.kind==="rollback"?"installed":
      rolledBack.has(item.to)&&item.to!==local?"rolled-back":item.to===local?"installed":"rolled-back";
   const link=linked(item.message??"",item.kind==="install"?branchesFromSnapshots(snapshots,item.from,item.to):null);
   result.push({id:"history:"+item.id,title:titleOf(item.to),version:item.to,
      description:item.message|| (item.kind==="rollback"?"Возврат к предыдущей версии":"Установка из Центра обновлений"),
      date:item.at,state,relatedBranches:link.ids,branchSource:link.source,evidence:null});
 }
 const latest=status?.latest;
 if(latest && latest.sha!==local){
   const description=[latest.description,...(latest.changes??[]).map(x=>x.title)].filter(Boolean).join(" · ");
   const state:EvolutionReleaseState=status?.phase==="ready"?"verified":
     status?.phase==="downloading"||status?.phase==="testing"?"downloading":
     status?.phase==="error"?"failed":"available";
   result.unshift({id:"latest:"+latest.sha,title:latest.changes?.[0]?.title||titleOf(latest.version),
      version:latest.version,description:description||"Описание изменений не получено",state,
      date:latest.date,relatedBranches:inferBranches(description),branchSource:inferBranches(description).length?"description":"none",
      evidence:latest.changes?.[0]?.pr? "https://github.com/Aspksa/JUUNIBI/pull/"+latest.changes[0].pr:
        "https://github.com/Aspksa/JUUNIBI/commit/"+latest.sha});
 }
 return result.slice(0,60);
}
export const evolutionStateLabel:Record<EvolutionReleaseState,string>={
 available:"Доступно",downloading:"Скачивается / проверяется",verified:"Скачано и проверено",
 installed:"Установлено", "rolled-back":"Неактивная версия",failed:"Ошибка подготовки"
};
