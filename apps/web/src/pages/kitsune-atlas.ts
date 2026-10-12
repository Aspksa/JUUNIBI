import {el} from "../dom";
import {CLANS,allNodes,clanColor,clansInUse,searchAtlas,layoutAtlas,type AtlasLayout,type AtlasNode} from "./kitsune-atlas-model";

/** Отрисовка «Атласа»: SVG с приближением и перетаскиванием (без анимации), поиск, легенда кланов и список-запасной вариант. */
export interface AtlasState{vb:[number,number,number,number]|null;query:string;clan:number|null;list:boolean|null}
export const newAtlasState=():AtlasState=>({vb:null,query:"",clan:null,list:null});

const NS="http://www.w3.org/2000/svg";
const s=(name:string,attrs:Record<string,string|number>={},...kids:(SVGElement|string)[])=>{
 const n=document.createElementNS(NS,name);
 for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
 for(const k of kids)n.append(k);
 return n as SVGElement;
};
const MIN_ZOOM=0.5,MAX_ZOOM=7;
export type ZoomBand="far"|"mid"|"near";
/** Уровень детализации: издалека видны ветви и хабы, ближе — листья, вплотную — подписи листьев. */
export const zoomBand=(zoom:number):ZoomBand=>zoom<1.5?"far":zoom<3.2?"mid":"near";
export const clampZoom=(z:number)=>Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number.isFinite(z)?z:1));
const EDGE_WIDTH=(depth:number)=>depth<=1?18:depth===2?10:6;

export interface AtlasOptions{
 tree:AtlasNode;state:AtlasState;onOpen:(n:AtlasNode)=>void;
}
export function atlasView(o:AtlasOptions):HTMLElement{
 const {tree,state}=o;
 const layout:AtlasLayout=layoutAtlas(tree);
 const nodes=allNodes(tree);
 const byId=new Map(nodes.map(n=>[n.id,n]));
 const base=layout.bounds;
 const v={x:state.vb?.[0]??base.x,y:state.vb?.[1]??base.y,w:state.vb?.[2]??base.w,h:state.vb?.[3]??base.h};
 const wide=typeof matchMedia==="function"&&matchMedia("(max-width:700px)").matches;
 let listMode=state.list??wide;

 const svg=s("svg",{class:"ka z-mid",viewBox:`${v.x} ${v.y} ${v.w} ${v.h}`,role:"group","aria-label":"Атлас Лисьего древа: большая карта проекта",preserveAspectRatio:"xMidYMid meet",tabindex:0}) as SVGSVGElement;
 // ствол: сужающийся, с землёй и корнями
 svg.append(s("ellipse",{cx:0,cy:150,rx:170,ry:20,class:"ka-ground"}),
  s("path",{d:"M-34 150 C-34 100 -18 60 -22 0 L22 0 C18 60 34 100 34 150 Z",class:"ka-trunk"}),
  s("path",{d:"M-30 146 Q-70 150 -120 160 M30 146 Q70 150 120 160",class:"ka-roots",fill:"none"}));
 const gEdges=s("g",{class:"ka-edges","aria-hidden":"true"});
 const gSpokes=s("g",{class:"ka-spokes","aria-hidden":"true"});
 const gHubs=s("g",{class:"ka-hubs"});
 const gLeaves=s("g",{class:"ka-leaves"});
 svg.append(gEdges,gSpokes,gHubs,gLeaves);
 const els=new Map<string,SVGElement>();
 const color=(n:AtlasNode,l=58)=>clanColor(n.clan,l);

 for(const e of layout.edges){
  const to=byId.get(e.to)!;
  const path=s("path",{d:e.d,class:"ka-edge",fill:"none","stroke-width":EDGE_WIDTH(e.depth),style:`--c:${color(to)}`});
  path.dataset.clan=String(e.clan);path.dataset.to=e.to;
  gEdges.append(path);
 }
 const leafAt=new Map(layout.leaves.map(l=>[l.id,l]));
 for(const l of layout.leaves){
  const hub=layout.placed.get(l.hub)!;
  const n=byId.get(l.id)!;
  const spoke=s("line",{x1:hub.x,y1:hub.y,x2:l.x,y2:l.y,class:"ka-spoke",style:`--c:${color(n)}`});
  spoke.dataset.clan=String(n.clan);
  gSpokes.append(spoke);
 }
 const open=(n:AtlasNode)=>o.onOpen(n);
 const bindOpen=(g:SVGElement,n:AtlasNode)=>{
  g.addEventListener("click",ev=>{if(dragMoved){ev.stopPropagation();return;}open(n);});
  g.addEventListener("keydown",ev=>{const k=(ev as KeyboardEvent).key;if(k==="Enter"||k===" "){ev.preventDefault();open(n);}});
 };
 let dragMoved=false;
 for(const p of layout.placed.values()){
  const n=p.node;
  const r=n.kind==="trunk"?46:n.kind==="branch"?24:13;
  const g=s("g",{class:`ka-node ${n.kind} st-${n.state}`,transform:`translate(${p.x} ${p.y})`,tabindex:0,role:"button",
   "aria-label":`${n.label}${n.note?". "+n.note:""}`,style:`--c:${color(n)}`});
  g.dataset.clan=String(n.clan);g.dataset.id=n.id;
  g.append(s("circle",{r:r+6,class:"ka-hit"}),s("circle",{r,class:"ka-disc"}));
  if(n.emoji){const t=s("text",{class:"ka-glyph","text-anchor":"middle",y:n.kind==="trunk"?12:n.kind==="branch"?7:5,"font-size":n.kind==="trunk"?34:n.kind==="branch"?20:14});t.textContent=n.emoji;g.append(t);}
  const lab=s("text",{class:"ka-label","text-anchor":"middle",y:r+(n.kind==="trunk"?24:16)});lab.textContent=n.label;g.append(lab);
  g.append(s("title",{},n.label+(n.note?" — "+n.note:"")));
  bindOpen(g,n);gHubs.append(g);els.set(n.id,g);
 }
 for(const n of nodes.filter(x=>x.kind==="leaf")){
  const l=leafAt.get(n.id)!;
  const g=s("g",{class:`ka-node leaf st-${n.state}`,transform:`translate(${l.x} ${l.y})`,tabindex:-1,role:"button","aria-label":`${n.label}${n.note?". "+n.note:""}`,style:`--c:${color(n)}`});
  g.dataset.clan=String(n.clan);g.dataset.id=n.id;
  g.append(s("circle",{r:12,class:"ka-hit"}),s("circle",{r:8.5,class:"ka-disc"}));
  if(n.emoji){const t=s("text",{class:"ka-glyph","text-anchor":"middle",y:3.6,"font-size":10});t.textContent=n.emoji;g.append(t);}
  const lab=s("text",{class:"ka-label","text-anchor":"middle",y:21});lab.textContent=n.label.length>22?n.label.slice(0,21)+"…":n.label;g.append(lab);
  g.append(s("title",{},n.label+(n.note?" — "+n.note:"")));
  bindOpen(g,n);gLeaves.append(g);els.set(n.id,g);
 }

 // ── приближение и перетаскивание: меняется только viewBox ──
 const fitW=base.w;
 const zoomOf=()=>fitW/v.w;
 const apply=()=>{
  svg.setAttribute("viewBox",[v.x,v.y,v.w,v.h].map(n=>n.toFixed(1)).join(" "));
  svg.classList.remove("z-far","z-mid","z-near");svg.classList.add("z-"+zoomBand(zoomOf()));
  const ppu=svg.getBoundingClientRect().width/v.w||0.3;
  svg.style.setProperty("--ls",String(Math.max(0.6,Math.min(6,1/ppu)).toFixed(2)));
  state.vb=[v.x,v.y,v.w,v.h];
 };
 const zoomAt=(factor:number,cx:number,cy:number)=>{
  const z=clampZoom(zoomOf()*factor);
  const w=fitW/z,h=v.h*(w/v.w);
  v.x=cx-(cx-v.x)*(w/v.w);v.y=cy-(cy-v.y)*(h/v.h);v.w=w;v.h=h;
  apply();
 };
 const toWorld=(clientX:number,clientY:number):[number,number]=>{
  const r=svg.getBoundingClientRect();
  const scale=Math.min(r.width/v.w,r.height/v.h)||1;
  const offX=(r.width-v.w*scale)/2,offY=(r.height-v.h*scale)/2;
  return [v.x+(clientX-r.left-offX)/scale,v.y+(clientY-r.top-offY)/scale];
 };
 svg.addEventListener("wheel",ev=>{ev.preventDefault();const [x,y]=toWorld(ev.clientX,ev.clientY);zoomAt(ev.deltaY<0?1.18:1/1.18,x,y);},{passive:false});
 let drag:{x:number;y:number;vx:number;vy:number}|null=null;
 svg.addEventListener("pointerdown",ev=>{
  if(ev.button!==0)return;
  drag={x:ev.clientX,y:ev.clientY,vx:v.x,vy:v.y};dragMoved=false;
  svg.setPointerCapture(ev.pointerId);svg.classList.add("is-drag");
 });
 svg.addEventListener("pointermove",ev=>{
  if(!drag)return;
  const r=svg.getBoundingClientRect();
  const scale=Math.min(r.width/v.w,r.height/v.h)||1;
  const dx=(ev.clientX-drag.x)/scale,dy=(ev.clientY-drag.y)/scale;
  if(Math.abs(ev.clientX-drag.x)+Math.abs(ev.clientY-drag.y)>5)dragMoved=true;
  v.x=drag.vx-dx;v.y=drag.vy-dy;apply();
 });
 const stopDrag=()=>{drag=null;svg.classList.remove("is-drag");setTimeout(()=>{dragMoved=false;},0);};
 svg.addEventListener("pointerup",stopDrag);svg.addEventListener("pointercancel",stopDrag);
 svg.addEventListener("keydown",ev=>{
  const k=(ev as KeyboardEvent).key;
  const step=v.w*0.08;
  if(k==="ArrowLeft"){v.x-=step;apply();ev.preventDefault();}
  else if(k==="ArrowRight"){v.x+=step;apply();ev.preventDefault();}
  else if(k==="ArrowUp"){v.y-=step;apply();ev.preventDefault();}
  else if(k==="ArrowDown"){v.y+=step;apply();ev.preventDefault();}
  else if(k==="+"||k==="="){zoomAt(1.25,v.x+v.w/2,v.y+v.h/2);ev.preventDefault();}
  else if(k==="-"){zoomAt(1/1.25,v.x+v.w/2,v.y+v.h/2);ev.preventDefault();}
  else if(k==="Home"){reset();ev.preventDefault();}
 });
 const reset=()=>{v.x=base.x;v.y=base.y;v.w=base.w;v.h=base.h;apply();};
 const focusOn=(id:string,zoom=2.4)=>{
  const p=layout.placed.get(id)??(leafAt.get(id)?{x:leafAt.get(id)!.x,y:leafAt.get(id)!.y}:null);
  if(!p)return;
  const w=fitW/zoom,h=base.h*(w/base.w);
  v.x=p.x-w/2;v.y=p.y-h/2;v.w=w;v.h=h;apply();
 };

 // ── поиск и кланы: меняются только классы ──
 const status=el("span",{cls:"ka-status muted",attrs:{"aria-live":"polite"}});
 const query=el("input",{cls:"kt-search ka-search",attrs:{type:"search",placeholder:"Найти на карте: ветвь, показатель, награда, файл…","aria-label":"Поиск по атласу"}});
 query.value=state.query;
 let hits=new Set<string>();
 const refresh=()=>{
  hits=searchAtlas(tree,state.query);
  const any=hits.size>0,iso=state.clan;
  for(const [id,g] of els){
   const n=byId.get(id)!;
   const clanOff=iso!==null&&n.clan!==iso&&n.kind!=="trunk";
   const hitOn=any&&hits.has(id);
   g.classList.toggle("is-hit",hitOn);
   g.classList.toggle("is-dim",clanOff||(any&&!hitOn));
  }
  for(const e of gEdges.children)(e as SVGElement).classList.toggle("is-dim",iso!==null&&Number((e as SVGElement).dataset.clan)!==iso);
  for(const e of gSpokes.children)(e as SVGElement).classList.toggle("is-dim",iso!==null&&Number((e as SVGElement).dataset.clan)!==iso);
  status.textContent=state.query.trim().length>=2?(any?`Найдено: ${hits.size}. Enter — перейти к первому.`:"Ничего не найдено."):"";
  legend.querySelectorAll<HTMLButtonElement>("button.ka-clan").forEach(b=>b.setAttribute("aria-pressed",String(iso!==null&&Number(b.dataset.clan)===iso)));
 };
 query.addEventListener("input",()=>{state.query=query.value;refresh();});
 query.addEventListener("keydown",ev=>{
  if(ev.key==="Enter"&&hits.size){
   const first=nodes.find(n=>hits.has(n.id));
   if(first){if(listMode){listMode=false;state.list=false;mount();}focusOn(first.id);}
  }
 });
 const legend=el("div",{cls:"ka-legend",attrs:{role:"group","aria-label":"Кланы ветвей: нажмите, чтобы оставить только один"}},
  ...clansInUse(tree).map(i=>{
   const b=el("button",{type:"button",cls:"ka-clan",attrs:{"aria-pressed":"false"}},el("i",{attrs:{style:`background:${clanColor(i)}`}}),CLANS[i]!.label);
   b.dataset.clan=String(i);
   b.addEventListener("click",()=>{state.clan=state.clan===i?null:i;refresh();});
   return b;
  }));

 // ── список: тот же состав без картинки (телефон и клавиатура) ──
 const list=el("div",{cls:"ka-list"});
 const buildList=()=>{
  list.replaceChildren(...tree.children.map(branch=>{
   const total=allNodes(branch).filter(n=>n.kind==="leaf").length;
   const d=el("details",{cls:"ka-list-branch",attrs:{style:`--c:${color(branch)}`}},
    el("summary",{},el("i",{}),el("strong",{textContent:(branch.emoji?branch.emoji+" ":"")+branch.label}),el("small",{cls:"muted",textContent:total?` · листьев ${total}`:""})));
   const walk=(n:AtlasNode,depth:number):HTMLElement=>{
    const wrap=el("div",{cls:"ka-list-group"});
    const openBtn=el("button",{type:"button",cls:"ka-list-item",textContent:(n.emoji?n.emoji+" ":"")+n.label,attrs:{title:n.note??""}});
    openBtn.addEventListener("click",()=>open(n));
    wrap.append(el("div",{cls:"ka-list-row",attrs:{style:`padding-left:${depth*14}px`}},openBtn,n.note?el("small",{cls:"muted",textContent:n.note}):null));
    const hubs=n.children.filter(c=>c.kind!=="leaf"),lf=n.children.filter(c=>c.kind==="leaf");
    for(const h of hubs)wrap.append(walk(h,depth+1));
    if(lf.length){
     const ul=el("div",{cls:"ka-list-leaves",attrs:{style:`padding-left:${(depth+1)*14}px`}});
     for(const l of lf){const b=el("button",{type:"button",cls:"ka-list-leaf st-"+l.state,textContent:(l.emoji?l.emoji+" ":"")+l.label,attrs:{title:l.note??""}});b.addEventListener("click",()=>open(l));ul.append(b);}
     wrap.append(ul);
    }
    return wrap;
   };
   d.append(walk(branch,0));
   return d;
  }));
 };

 // ── сборка ──
 const toggle=el("button",{type:"button",cls:"kt-chip"});
 const zoomBox=el("div",{cls:"ka-zoom",attrs:{role:"group","aria-label":"Масштаб"}});
 for(const [label,fn,aria] of [["−",()=>zoomAt(1/1.3,v.x+v.w/2,v.y+v.h/2),"Отдалить"],["+",()=>zoomAt(1.3,v.x+v.w/2,v.y+v.h/2),"Приблизить"],["Вся карта",reset,"Показать всю карту"]] as [string,()=>void,string][]){
  const b=el("button",{type:"button",cls:"kt-chip",textContent:label,attrs:{"aria-label":aria}});b.addEventListener("click",fn);zoomBox.append(b);
 }
 const stage=el("div",{cls:"ka-stage"});
 const hint=el("p",{cls:"ka-hint muted",textContent:"Колесо мыши — приближение, перетаскивание — сдвиг, клик по кружку — подробности. Подписи листьев видны при приближении."});
 const root=el("section",{cls:"ka-wrap",attrs:{"aria-label":"Атлас"}},
  el("div",{cls:"ka-bar"},query,zoomBox,toggle),status,legend,stage,hint);
 const mount=()=>{
  toggle.textContent=listMode?"Показать карту":"Показать списком";
  zoomBox.hidden=listMode;hint.hidden=listMode;
  if(listMode){buildList();stage.replaceChildren(list);}
  else stage.replaceChildren(svg);
  root.classList.toggle("is-list",listMode);
  apply();refresh();
 };
 toggle.addEventListener("click",()=>{listMode=!listMode;state.list=listMode;mount();});
 mount();
 return root;
}
