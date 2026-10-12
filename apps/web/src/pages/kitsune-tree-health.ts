/** Read-only architectural health assessment for Fox Tree. Never interprets a manifest as proof of installation. */
export interface TreeHealthNode { id:string; title:string; status:"implemented"|"planned"; dependsOn:string[]; stage:number }
export interface TreeHealth {
  total:number; implemented:number; planned:number; ready:string[]; blocked:{id:string;dependencies:string[]}[];
  missing:{id:string;dependency:string}[]; cycles:string[][]; hotspots:{id:string;dependents:number}[];
}
export function assessTreeHealth(nodes:readonly TreeHealthNode[]):TreeHealth {
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const missing:{id:string;dependency:string}[]=[];
  const ready:string[]=[],blocked:{id:string;dependencies:string[]}[]=[];
  for(const node of nodes) {
    const absent=node.dependsOn.filter(id=>!byId.has(id));
    for(const dependency of absent)missing.push({id:node.id,dependency});
    if(node.status==="planned"){
      const dependencies=node.dependsOn.filter(id=>byId.get(id)?.status!=="implemented");
      if(dependencies.length)blocked.push({id:node.id,dependencies});
      else ready.push(node.id);
    }
  }
  const color=new Map<string,number>(),stack:string[]=[],cycles:string[][]=[],seen=new Set<string>();
  const visit=(id:string):void=>{
    color.set(id,1);stack.push(id);
    for(const parent of byId.get(id)?.dependsOn??[]){
      if(!byId.has(parent))continue;
      if(color.get(parent)===1) {
        const cycle=stack.slice(stack.indexOf(parent)).concat(parent);
        const key=[...new Set(cycle)].sort().join("|");
        if(!seen.has(key)){seen.add(key);cycles.push(cycle);}
      } else if(!color.has(parent))visit(parent);
    }
    stack.pop();color.set(id,2);
  };
  for(const node of nodes)if(!color.has(node.id))visit(node.id);
  const hotspots=nodes.map(node=>({id:node.id,dependents:nodes.filter(n=>n.dependsOn.includes(node.id)).length}))
    .filter(x=>x.dependents>0).sort((a,b)=>b.dependents-a.dependents||a.id.localeCompare(b.id)).slice(0,8);
  return {total:nodes.length,implemented:nodes.filter(n=>n.status==="implemented").length,
    planned:nodes.filter(n=>n.status==="planned").length,ready,blocked,missing,cycles,hotspots};
}
