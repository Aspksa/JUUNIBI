import type {TreeHealthNode} from "./kitsune-tree-health";

/** Deterministic route to a planned capability, with truthful dependency gates. */
export function treeDevelopmentRoute(nodes:readonly TreeHealthNode[], target:string) {
 const byId=new Map(nodes.map(n=>[n.id,n]));
 if(!byId.has(target))return {target,steps:[],missing:[target],cycles:[],ready:false,affected:[]};
 const visited=new Set<string>(),active=new Set<string>(),steps:string[]=[],missing:string[]=[],cycles:string[]=[];
 const walk=(id:string):void=>{
  if(active.has(id)){cycles.push(id);return;}
  if(visited.has(id))return;
  const node=byId.get(id);if(!node){missing.push(id);return;}
  active.add(id);
  for(const dependency of node.dependsOn)walk(dependency);
  active.delete(id);visited.add(id);steps.push(id);
 };
 walk(target);
 const affected:string[]=[],queue=[target],seen=new Set<string>([target]);
 for(let i=0;i<queue.length;i++){
  for(const node of nodes)if(node.dependsOn.includes(queue[i]!)&&!seen.has(node.id)){
   seen.add(node.id);queue.push(node.id);affected.push(node.id);
  }
 }
 return {target,steps:steps.map(id=>({id,status:byId.get(id)!.status,stage:byId.get(id)!.stage})),
   missing,cycles,ready:missing.length===0&&cycles.length===0&&
   (byId.get(target)?.dependsOn??[]).every(id=>byId.get(id)?.status==="implemented"),
   affected};
}
