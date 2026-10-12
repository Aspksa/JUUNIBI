export interface EvolutionNode {
 id:string;title:string;description:string;how:string;status:"implemented"|"planned";dependsOn:string[];stage:number;evidence?:string;introducedIn?:{sha:string;pr:number};
}
export interface EvolutionManifest {schemaVersion:number;project:string;nodes:EvolutionNode[]}
export interface EvolutionSnapshot {
 manifest:EvolutionManifest;
 timeline:{history:{id:string;at:string;kind:string;from:string;to:string;message:string}[];activeVersion:string;durable:boolean;snapshots?:{version:string;digest:string;manifest:EvolutionManifest}[]};
 discovery?:{scanned:number;modules:{id:string;file:string;imports:string[];candidate:boolean}[];candidates:{id:string;file:string;imports:string[];candidate:boolean}[];cycles:string[][];unresolved:string[];manifestGaps:string[];truncated:boolean};
 phase:string;latest:unknown;
 /** Whether Python 3 (needed for the SQLite histories) was found; `reason` says what to do when it was not. */
 python?:{ok:boolean;version?:string;reason?:string};
 warning?:string;
}
export function validateEvolutionManifest(raw:unknown):EvolutionManifest {
 if(!raw||typeof raw!=="object")throw new Error("Некорректный манифест");
 const obj=raw as Partial<EvolutionManifest>;
 if(obj.schemaVersion!==1||obj.project!=="JUUNIBI"||!Array.isArray(obj.nodes)||obj.nodes.length>500)
   throw new Error("Неизвестная версия манифеста");
 const ids=new Set<string>();
 for(const node of obj.nodes){
   if(typeof node.id!=="string"||! /^[a-z0-9-]{1,64}$/.test(node.id)||ids.has(node.id)||
     typeof node.title!=="string"||node.title.length>150||typeof node.description!=="string"||
     typeof node.how!=="string"||!["planned","implemented"].includes(node.status)||
     !Array.isArray(node.dependsOn)||!Number.isInteger(node.stage)||node.stage<0||node.stage>100)
     throw new Error("Недопустимая ветвь");
   if(node.introducedIn && (!/^[0-9a-f]{40}$/.test(node.introducedIn.sha)||!Number.isInteger(node.introducedIn.pr)||node.introducedIn.pr<1))throw new Error("Некорректное происхождение ветви");
   ids.add(node.id);
 }
 for(const node of obj.nodes)if(node.dependsOn.some(id=>!ids.has(id)||id===node.id))
   throw new Error("Неизвестная или циклическая зависимость");
 const byId=new Map(obj.nodes.map(n=>[n.id,n]));
 function walk(id:string,visiting:Set<string>,visited:Set<string>):void{
  if(visited.has(id))return;
  if(visiting.has(id))throw new Error("Цикл зависимостей");
  visiting.add(id);
  for(const parent of byId.get(id)?.dependsOn??[])walk(parent,visiting,visited);
  visiting.delete(id);visited.add(id);
 }
 const visited=new Set<string>();
 for(const id of ids)walk(id,new Set(),visited);
 return obj as EvolutionManifest;
}
export function recommendEvolution(manifest:EvolutionManifest){
 return manifest.nodes.filter(n=>n.status==="planned").map(node=>{
  const blocked=node.dependsOn.filter(id=>manifest.nodes.find(n=>n.id===id)?.status!=="implemented");
  const impacted=manifest.nodes.filter(n=>n.dependsOn.includes(node.id)).map(n=>n.id);
  return {nodeId:node.id,title:node.title,ready:blocked.length===0,blockedBy:blocked,
    affectedBranches:impacted,explanation:blocked.length?
     "Прежде чем развивать ветвь, нужно реализовать зависимости: "+blocked.join(", "):
     "Известные прямые зависимости реализованы; требуется техническая проверка перед началом работ",
    executesAutomatically:false,requiresOwnerApproval:true};
 });
}
