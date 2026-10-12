import {el} from "../dom";

/**
 * Дерево одним рисунком, без анимации: ствол внизу (ядро), выше — ветви-модули по этапам, над ними — крона из
 * 10 «кустов» (миры показателей). Раскладка детерминирована, узлы доступны с клавиатуры.
 */
export interface ArtNode{id:string;title:string;status:"implemented"|"planned";dependsOn:string[];stage:number}
export interface CrownBush{id:string;emoji:string;title:string;confirmed:number;total:number}
export type ArtLayer="structure"|"links"|"stages"|"impact";
export interface ArtLayout{
 width:number;height:number;
 nodes:{id:string;x:number;y:number;title:string;status:ArtNode["status"]}[];
 edges:{from:string;to:string;d:string;planned:boolean}[];
 /** Полосы этапов: высота и номер уровня (для слоя «Этапы»). */
 levels:{stage:number;y:number}[];
 crown:{x:number;y:number}[];
}
const SPACING=132,ROW=108,PAD_BOTTOM=100,CROWN_HEIGHT=160,PAD_TOP_PLAIN=52;

/** Расстояния от ветви до всего, что от неё зависит (в шагах). Источник не входит в результат. */
export function downstreamDepths(nodes:Pick<ArtNode,"id"|"dependsOn">[],source:string):Map<string,number>{
 const depth=new Map<string,number>([[source,0]]);
 const queue=[source];
 for(let i=0;i<queue.length;i++){
  const current=queue[i]!;
  for(const n of nodes)if(n.dependsOn.includes(current)&&!depth.has(n.id)){depth.set(n.id,depth.get(current)!+1);queue.push(n.id);}
 }
 depth.delete(source);
 return depth;
}
/** Сколько ветвей нужны этой (↑) и сколько зависят от неё напрямую (↓). */
export function degrees(nodes:Pick<ArtNode,"id"|"dependsOn">[]):Map<string,{up:number;down:number}>{
 const ids=new Set(nodes.map(n=>n.id));
 const result=new Map(nodes.map(n=>[n.id,{up:n.dependsOn.filter(d=>ids.has(d)).length,down:0}]));
 for(const n of nodes)for(const d of n.dependsOn)if(result.has(d))result.get(d)!.down++;
 return result;
}

/** Раскладка: уровни по этапам, внутри уровня — по среднему положению родителей, чтобы ветви не пересекались. */
export function layoutTreeArt(nodes:ArtNode[],crownCount=0):ArtLayout{
 const stages=[...new Set(nodes.map(n=>n.stage))].sort((a,b)=>a-b);
 const perLevel=Math.max(1,...stages.map(s=>nodes.filter(n=>n.stage===s).length));
 const width=Math.max(crownCount?660:380,(perLevel+1)*SPACING);
 const top=crownCount?CROWN_HEIGHT:PAD_TOP_PLAIN;
 const height=top+PAD_BOTTOM+Math.max(0,stages.length-1)*ROW;
 const pos=new Map<string,{x:number;y:number}>();
 const levels:ArtLayout["levels"]=[];
 stages.forEach((stage,level)=>{
  const row=nodes.filter(n=>n.stage===stage);
  const key=(n:ArtNode)=>{
   const parents=n.dependsOn.map(id=>pos.get(id)?.x).filter((x):x is number=>x!==undefined);
   return parents.length?parents.reduce((a,b)=>a+b,0)/parents.length:width/2;
  };
  row.sort((a,b)=>key(a)-key(b)||a.id.localeCompare(b.id));
  const y=height-PAD_BOTTOM-level*ROW;
  levels.push({stage,y});
  const gap=Math.min(SPACING,(width-60)/Math.max(1,row.length));
  row.forEach((n,i)=>{
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
 // Крона: купол из кустов над самым верхним рядом ветвей.
 const crown:{x:number;y:number}[]=[];
 for(let i=0;i<crownCount;i++){
  const t=crownCount===1?0:(i/(crownCount-1))*2-1;
  crown.push({x:Math.round(60+(t+1)/2*(width-120)),y:Math.round(92-48*(1-t*t))});
 }
 return {width,height,nodes:nodes.filter(n=>pos.has(n.id)).map(n=>({id:n.id,title:n.title,status:n.status,...pos.get(n.id)!})),edges,levels,crown};
}
/** Подпись под листом: не больше двух строк. */
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
export type BushState="full"|"part"|"empty";
export const bushState=(b:Pick<CrownBush,"confirmed"|"total">):BushState=>b.confirmed<=0?"empty":b.confirmed>=b.total?"full":"part";

const NS="http://www.w3.org/2000/svg";
const s=(name:string,attrs:Record<string,string|number>={},...kids:(SVGElement|string)[])=>{
 const n=document.createElementNS(NS,name);
 for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
 for(const k of kids)n.append(k);
 return n;
};
const LEAF="M0 -17 C12 -12 12 9 0 19 C-12 9 -12 -12 0 -17 Z";

export interface TreeArtOptions{
 selected:string;highlight?:ReadonlySet<string>;layer?:ArtLayer;crown?:CrownBush[];
 onSelect:(id:string)=>void;onCrown?:(id:string)=>void;
}
export function treeArt(nodes:ArtNode[],o:TreeArtOptions):HTMLElement{
 const layer=o.layer??"structure";
 const lay=layoutTreeArt(nodes,o.crown?.length??0);
 const root=s("svg",{viewBox:`0 0 ${lay.width} ${lay.height}`,class:"kta layer-"+layer,role:"group","aria-label":"Дерево развития JUUNIBI",preserveAspectRatio:"xMidYMid meet"}) as SVGSVGElement;
 const trunkNode=lay.nodes.find(n=>n.id===nodes.find(x=>x.stage===Math.min(...nodes.map(m=>m.stage)))?.id);
 const cx=trunkNode?.x??lay.width/2,ground=lay.height-38;
 const impact=layer==="impact"&&o.selected?downstreamDepths(nodes,o.selected):null;
 const inSet=(id:string)=>id===o.selected||Boolean(impact?.has(id));
 const deg=degrees(nodes);
 if(layer==="stages"){
  const bands=s("g",{class:"kta-bands","aria-hidden":"true"});
  for(const l of lay.levels){
   bands.append(s("line",{x1:18,x2:lay.width-18,y1:l.y,y2:l.y,class:"kta-band"}));
   const t=s("text",{x:20,y:l.y-8,class:"kta-band-label"});t.textContent="Этап "+l.stage;bands.append(t);
  }
  root.append(bands);
 }
 // Земля, ствол и корни: только украшение.
 const tY=trunkNode?.y??ground-60;
 root.append(
  s("ellipse",{cx,cy:ground+4,rx:Math.min(210,lay.width*.36),ry:12,class:"kta-ground"}),
  s("path",{d:`M${cx-12} ${ground} C${cx-12} ${ground-26} ${cx-6} ${tY+14} ${cx} ${tY+8} C${cx+6} ${tY+14} ${cx+12} ${ground-26} ${cx+12} ${ground} Z`,class:"kta-trunk"}),
  s("path",{d:`M${cx-10} ${ground-2} Q${cx-34} ${ground+4} ${cx-62} ${ground+10} M${cx+10} ${ground-2} Q${cx+34} ${ground+4} ${cx+62} ${ground+10}`,class:"kta-root",fill:"none"}));
 const edges=s("g",{class:"kta-edges","aria-hidden":"true"});
 for(const e of lay.edges){
  const active=impact?(inSet(e.from)&&Boolean(impact.has(e.to))):(e.from===o.selected||e.to===o.selected);
  edges.append(s("path",{d:e.d,class:"kta-edge"+(e.planned?" planned":"")+(active?" active":"")+(impact&&!active?" dim":""),fill:"none"}));
 }
 root.append(edges);
 // Крона: 10 миров показателей.
 if(o.crown?.length){
  const crown=s("g",{class:"kta-crown",role:"group","aria-label":"Крона: показатели по мирам"});
  crown.append(s("ellipse",{cx:lay.width/2,cy:80,rx:lay.width/2-34,ry:62,class:"kta-canopy","aria-hidden":"true"}));
  o.crown.forEach((b,i)=>{
   const p=lay.crown[i]!,state=bushState(b),ratio=b.total?b.confirmed/b.total:0;
   const g=s("g",{class:"kta-bush "+state,transform:`translate(${p.x} ${p.y})`,tabindex:0,role:"button",
    "aria-label":`${b.title}: подтверждено ${b.confirmed} из ${b.total}`});
   const circ=2*Math.PI*21;
   g.append(s("circle",{r:27,class:"kta-hit"}),s("circle",{r:21,class:"kta-bush-face"}),
    s("circle",{r:21,class:"kta-bush-ring",fill:"none","stroke-dasharray":`${(circ*ratio).toFixed(1)} ${circ.toFixed(1)}`,transform:"rotate(-90)"}));
   const glyph=s("text",{class:"kta-bush-glyph","text-anchor":"middle",y:7});glyph.textContent=b.emoji;
   const count=s("text",{class:"kta-bush-count","text-anchor":"middle",y:40});count.textContent=`${b.confirmed}/${b.total}`;
   g.append(glyph,count,s("title",{},`${b.title}: подтверждено ${b.confirmed} из ${b.total}`));
   const pick=()=>o.onCrown?.(b.id);
   g.addEventListener("click",pick);
   g.addEventListener("keydown",e=>{const k=(e as KeyboardEvent).key;if(k==="Enter"||k===" "){e.preventDefault();pick();}});
   crown.append(g);
  });
  root.append(crown);
 }
 for(const n of lay.nodes){
  const planned=n.status==="planned";
  const lines=labelLines(n.title);
  const depth=impact?.get(n.id);
  const state=impact?(n.id===o.selected?" source":depth!==undefined?" affected":" dim"):"";
  const group=s("g",{class:"kta-node"+(planned?" planned":" ok")+(n.id===o.selected?" selected":"")+(o.highlight?.has(n.id)?" fresh":"")+state,
   transform:`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`,tabindex:0,role:"button",
   "aria-label":`${n.title} — ${planned?"запланировано":"подтверждено"}${depth!==undefined?`, зависит от выбранной ветви, шагов: ${depth}`:""}`,"aria-pressed":String(n.id===o.selected)});
  group.append(
   s("circle",{r:30,class:"kta-hit"}),
   s("circle",{r:25,class:"kta-ring"}),
   s("path",{d:LEAF,class:"kta-leaf",transform:`rotate(${((n.x-lay.width/2)/lay.width*34).toFixed(1)})`}));
  const text=s("text",{class:"kta-label","text-anchor":"middle",y:40});
  lines.forEach((line,i)=>{const t=s("tspan",{x:0,dy:i===0?0:15});t.textContent=line;text.append(t);});
  group.append(text);
  if(layer==="links"){
   const d=deg.get(n.id)!;
   const t=s("text",{class:"kta-deg","text-anchor":"middle",y:40+15*lines.length});t.textContent=`↑${d.up}  ↓${d.down}`;group.append(t);
  }
  if(depth!==undefined){
   group.append(s("circle",{cx:20,cy:-20,r:10,class:"kta-badge"}));
   const t=s("text",{x:20,y:-16,class:"kta-badge-text","text-anchor":"middle"});t.textContent=String(depth);group.append(t);
  }
  group.append(s("title",{},n.title));
  const pick=()=>o.onSelect(n.id);
  group.addEventListener("click",pick);
  group.addEventListener("keydown",e=>{const k=(e as KeyboardEvent).key;if(k==="Enter"||k===" "){e.preventDefault();pick();}});
  root.append(group);
 }
 return el("div",{cls:"kta-wrap"},root);
}
