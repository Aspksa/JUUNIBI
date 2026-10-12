import {el} from "../dom";

/** The tree as a still picture: the trunk (stage 0) at the bottom, later stages grow upward. No animation. */
export interface ArtNode{id:string;title:string;status:"implemented"|"planned";dependsOn:string[];stage:number}
export interface ArtLayout{
 width:number;height:number;
 nodes:{id:string;x:number;y:number;title:string;status:ArtNode["status"]}[];
 edges:{from:string;to:string;d:string;planned:boolean}[];
}
const SPACING=132,ROW=104,PAD_TOP=56,PAD_BOTTOM=96;

/** Deterministic layout: levels by stage, nodes ordered by the average position of their parents to keep branches apart. */
export function layoutTreeArt(nodes:ArtNode[]):ArtLayout{
 const stages=[...new Set(nodes.map(n=>n.stage))].sort((a,b)=>a-b);
 const perLevel=Math.max(1,...stages.map(s=>nodes.filter(n=>n.stage===s).length));
 const width=Math.max(380,(perLevel+1)*SPACING);
 const height=PAD_TOP+PAD_BOTTOM+Math.max(0,stages.length-1)*ROW;
 const pos=new Map<string,{x:number;y:number}>();
 stages.forEach((stage,level)=>{
  const row=nodes.filter(n=>n.stage===stage);
  const key=(n:ArtNode)=>{
   const parents=n.dependsOn.map(id=>pos.get(id)?.x).filter((x):x is number=>x!==undefined);
   return parents.length?parents.reduce((a,b)=>a+b,0)/parents.length:width/2;
  };
  row.sort((a,b)=>key(a)-key(b)||a.id.localeCompare(b.id));
  const y=height-PAD_BOTTOM-level*ROW;
  const gap=Math.min(SPACING,(width-60)/Math.max(1,row.length));
  row.forEach((n,i)=>{
   // Spread around the parents' centre, but keep inside the picture.
   const centre=row.reduce((s,m)=>s+key(m),0)/row.length;
   const x=Math.max(46,Math.min(width-46,centre+(i-(row.length-1)/2)*gap));
   pos.set(n.id,{x,y});
  });
 });
 const byId=new Map(nodes.map(n=>[n.id,n]));
 const edges=nodes.flatMap(n=>n.dependsOn.filter(id=>pos.has(id)).map(from=>{
  const a=pos.get(from)!,b=pos.get(n.id)!;
  const mid=(a.y+b.y)/2;
  return {from,to:n.id,d:`M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${a.x.toFixed(1)} ${mid.toFixed(1)} ${b.x.toFixed(1)} ${mid.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
   planned:n.status==="planned"||byId.get(from)?.status==="planned"};
 }));
 return {width,height,nodes:nodes.filter(n=>pos.has(n.id)).map(n=>({id:n.id,title:n.title,status:n.status,...pos.get(n.id)!})),edges};
}
/** Splits a title into at most two lines for the label under a leaf. */
export function labelLines(title:string,max=16):string[]{
 const words=title.trim().split(/\s+/).filter(Boolean);
 const lines:string[]=[];let line="";
 for(const w of words){
  if(line&&(line+" "+w).length>max){lines.push(line);line=w;}else line=line?line+" "+w:w;
 }
 if(line)lines.push(line);
 if(lines.length<=2)return lines.map(l=>l.length>max+4?l.slice(0,max+3)+"…":l);
 const first=lines[0]!,rest=lines.slice(1).join(" ");
 return [first,rest.length>max+2?rest.slice(0,max+1)+"…":rest];
}
const NS="http://www.w3.org/2000/svg";
const s=(name:string,attrs:Record<string,string|number>={},...kids:(SVGElement|string)[])=>{
 const n=document.createElementNS(NS,name);
 for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
 for(const k of kids)n.append(k);
 return n;
};
const LEAF="M0 -17 C12 -12 12 9 0 19 C-12 9 -12 -12 0 -17 Z";

export interface TreeArtOptions{selected:string;highlight?:ReadonlySet<string>;onSelect:(id:string)=>void}
export function treeArt(nodes:ArtNode[],o:TreeArtOptions):HTMLElement{
 const lay=layoutTreeArt(nodes);
 const root=s("svg",{viewBox:`0 0 ${lay.width} ${lay.height}`,class:"kta","role":"group","aria-label":"Дерево развития JUUNIBI",preserveAspectRatio:"xMidYMid meet"}) as SVGSVGElement;
 const trunk=lay.nodes.find(n=>n.id===nodes.find(x=>x.stage===Math.min(...nodes.map(m=>m.stage)))?.id);
 const cx=trunk?.x??lay.width/2,ground=lay.height-34;
 // ground and the trunk with two roots: purely decorative
 root.append(
  s("ellipse",{cx,cy:ground+4,rx:Math.min(210,lay.width*.36),ry:12,class:"kta-ground"}),
  s("path",{d:`M${cx-12} ${ground} C${cx-12} ${ground-26} ${cx-6} ${(trunk?.y??ground-60)+14} ${cx} ${(trunk?.y??ground-60)+8} C${cx+6} ${(trunk?.y??ground-60)+14} ${cx+12} ${ground-26} ${cx+12} ${ground} Z`,class:"kta-trunk"}),
  s("path",{d:`M${cx-10} ${ground-2} Q${cx-34} ${ground+4} ${cx-62} ${ground+10} M${cx+10} ${ground-2} Q${cx+34} ${ground+4} ${cx+62} ${ground+10}`,class:"kta-root",fill:"none"}));
 const edges=s("g",{class:"kta-edges","aria-hidden":"true"});
 for(const e of lay.edges){
  const active=e.from===o.selected||e.to===o.selected;
  edges.append(s("path",{d:e.d,class:"kta-edge"+(e.planned?" planned":"")+(active?" active":""),fill:"none"}));
 }
 root.append(edges);
 for(const n of lay.nodes){
  const planned=n.status==="planned";
  const lines=labelLines(n.title);
  const group=s("g",{class:"kta-node"+(planned?" planned":" ok")+(n.id===o.selected?" selected":"")+(o.highlight?.has(n.id)?" fresh":""),
   transform:`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`,tabindex:0,role:"button",
   "aria-label":`${n.title} — ${planned?"запланировано":"подтверждено"}`,"aria-pressed":String(n.id===o.selected)});
  group.append(
   s("circle",{r:30,class:"kta-hit"}),
   s("circle",{r:25,class:"kta-ring"}),
   s("path",{d:LEAF,class:"kta-leaf",transform:`rotate(${((n.x-lay.width/2)/lay.width*34).toFixed(1)})`}));
  const text=s("text",{class:"kta-label","text-anchor":"middle",y:40});
  lines.forEach((line,i)=>{const t=s("tspan",{x:0,dy:i===0?0:15});t.textContent=line;text.append(t);});
  group.append(text,s("title",{},n.title));
  const pick=()=>o.onSelect(n.id);
  group.addEventListener("click",pick);
  group.addEventListener("keydown",e=>{const k=(e as KeyboardEvent).key;if(k==="Enter"||k===" "){e.preventDefault();pick();}});
  root.append(group);
 }
 return el("div",{cls:"kta-wrap"},root);
}
