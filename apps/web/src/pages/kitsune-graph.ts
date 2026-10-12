import type { EvolutionNode } from "./kitsune-evolution-model";
export interface Point {x:number;y:number}
export type Positions=Record<string,Point>;
const KEY="juunibi:kitsune:positions:v1";
export function defaultPositions(nodes:EvolutionNode[]):Positions {
 const lanes=new Map<number,number>();const positions:Positions={};
 for(const node of [...nodes].sort((a,b)=>a.stage-b.stage||a.id.localeCompare(b.id))){
   const n=lanes.get(node.stage)??0;lanes.set(node.stage,n+1);
   positions[node.id]={x:45+node.stage*235,y:40+n*112};
 }return positions;
}
export function cleanPositions(raw:unknown,nodes:EvolutionNode[]):Positions {
 const defaults=defaultPositions(nodes);
 if(!raw||typeof raw!=="object")return defaults;
 for(const id of Object.keys(defaults)){
   const p=(raw as Record<string,unknown>)[id];
   if(p&&typeof p==="object"){
     const q=p as Partial<Point>;
     if(typeof q.x==="number"&&Number.isFinite(q.x)&&q.x>=0&&q.x<=20000&&
        typeof q.y==="number"&&Number.isFinite(q.y)&&q.y>=0&&q.y<=20000)
       defaults[id]={x:q.x,y:q.y};
   }
 }return defaults;
}
export function readPositions(nodes:EvolutionNode[]):Positions {
 try{return cleanPositions(JSON.parse(localStorage.getItem(KEY)??"null") as unknown,nodes);}
 catch{return defaultPositions(nodes);}
}
export function savePositions(p:Positions):void {
 try{localStorage.setItem(KEY,JSON.stringify(p));}catch{/* private storage disabled */}
}
export function buildGraph(nodes:EvolutionNode[], selected:string,onSelect:(id:string)=>void,zoom=1):HTMLElement {
 const positions=readPositions(nodes);
 const viewport=document.createElement("div");viewport.className="kt-canvas-viewport";
 viewport.setAttribute("aria-label","Интерактивная карта связей JUUNIBI");
 const canvas=document.createElement("div");canvas.className="kt-canvas";
 canvas.style.transform=`scale(${zoom})`;canvas.style.transformOrigin="top left";
 const maxX=Math.max(1000,...Object.values(positions).map(p=>p.x+240));
 const maxY=Math.max(600,...Object.values(positions).map(p=>p.y+120));
 canvas.style.width=maxX+"px";canvas.style.height=maxY+"px";
 const ns="http://www.w3.org/2000/svg";
 const svg=document.createElementNS(ns,"svg");svg.setAttribute("class","kt-canvas-edges");
 svg.setAttribute("viewBox",`0 0 ${maxX} ${maxY}`);svg.setAttribute("aria-hidden","true");
 function lines(){
   svg.replaceChildren();
   for(const n of nodes)for(const id of n.dependsOn){
     const a=positions[id],b=positions[n.id];if(!a||!b)continue;
     const line=document.createElementNS(ns,"path");
     line.setAttribute("d",`M ${a.x+178} ${a.y+35} C ${a.x+215} ${a.y+35}, ${b.x-35} ${b.y+35}, ${b.x} ${b.y+35}`);
     line.setAttribute("fill","none");line.setAttribute("stroke","currentColor");line.setAttribute("stroke-width",id===selected||n.id===selected?"2.6":"1.3");
     line.setAttribute("opacity",id===selected||n.id===selected?".9":".27");svg.append(line);
   }
 }
 lines();canvas.append(svg);
 for(const n of nodes){
   const node=document.createElement("button");node.type="button";
   node.className="kt-canvas-node"+(n.id===selected?" selected":"")+(n.status==="planned"?" planned":"");
   node.textContent=n.title;node.style.left=positions[n.id]!.x+"px";node.style.top=positions[n.id]!.y+"px";
   node.setAttribute("aria-label",n.title+", "+(n.status==="planned"?"запланировано":"реализовано")+". Перетащите, чтобы переместить");
   node.addEventListener("click",()=>{if(!suppressClick)onSelect(n.id);suppressClick=false;});
   let suppressClick=false;let start:Point|null=null;let origin:Point|null=null;
   node.addEventListener("pointerdown",e=>{
     if(e.button!==0)return;
     start={x:e.clientX,y:e.clientY};origin={...positions[n.id]!};
     node.setPointerCapture(e.pointerId);
   });
   node.addEventListener("pointermove",e=>{
     if(!start||!origin)return;
     const dx=(e.clientX-start.x)/zoom,dy=(e.clientY-start.y)/zoom;
     if(Math.abs(dx)+Math.abs(dy)>4)suppressClick=true;
     positions[n.id]={x:Math.min(20000,Math.max(0,origin.x+dx)),y:Math.min(20000,Math.max(0,origin.y+dy))};
     node.style.left=positions[n.id]!.x+"px";node.style.top=positions[n.id]!.y+"px";lines();
   });
   const end=()=>{if(start){savePositions(positions);start=null;origin=null;}};
   node.addEventListener("pointerup",end);node.addEventListener("pointercancel",end);
   canvas.append(node);
 }
 viewport.append(canvas);return viewport;
}
