import {el} from "../dom";
import {CLANS,allNodes,clanColor,clansInUse,searchAtlas,type AtlasNode} from "./kitsune-atlas-model";
import {defaultExpanded,expandToDepth,layoutMind,maxDepth,pathTo,revealHits,shortLabel,type MindBox,type MindLayout} from "./kitsune-mindmap-model";

/**
 * «Карта-схема»: интеллект-карта проекта. Ветви раскрываются вправо, путь до корня подсвечивается
 * бегущим свечением, связи манифеста («зависит от») показываются пунктиром при наведении.
 * Эффекты короткие и отключаются при «уменьшить движение».
 */
export interface MindState{expanded:Set<string>|null;vb:[number,number,number,number]|null;query:string;clan:number|null}
export const newMindState=():MindState=>({expanded:null,vb:null,query:"",clan:null});

const NS="http://www.w3.org/2000/svg";
const s=(name:string,attrs:Record<string,string|number>={},...kids:(SVGElement|string)[])=>{
 const n=document.createElementNS(NS,name);
 for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
 for(const k of kids)n.append(k);
 return n as SVGElement;
};
const MIN_ZOOM=0.3,MAX_ZOOM=3;
export interface MindOptions{
 tree:AtlasNode;state:MindState;onOpen:(n:AtlasNode)=>void;
 /** id узла → id узлов, от которых он зависит (из манифеста) */
 deps:Record<string,string[]>;
}
export function mindView(o:MindOptions):HTMLElement{
 const {tree,state}=o;
 const nodes=allNodes(tree);
 const byNode=new Map(nodes.map(n=>[n.id,n]));
 const parentOf=new Map<string,string>();
 for(const n of nodes)for(const c of n.children)parentOf.set(c.id,n.id);
 const dependents:Record<string,string[]>={};
 for(const [id,list] of Object.entries(o.deps))for(const d of list)(dependents[d]??=[]).push(id);
 let expanded=state.expanded??defaultExpanded(tree);
 state.expanded=expanded;
 let layout:MindLayout=layoutMind(tree,expanded);
 const color=(n:AtlasNode,l=58)=>clanColor(n.clan,l);
 const v={x:state.vb?.[0]??layout.bounds.x,y:state.vb?.[1]??layout.bounds.y,w:state.vb?.[2]??layout.bounds.w,h:state.vb?.[3]??layout.bounds.h};

 const svg=s("svg",{class:"km",viewBox:`${v.x} ${v.y} ${v.w} ${v.h}`,role:"tree","aria-label":"Карта-схема проекта",preserveAspectRatio:"xMidYMid meet",tabindex:0}) as SVGSVGElement;
 const defs=s("defs",{});
 const glow=s("filter",{id:"km-glow",x:"-40%",y:"-60%",width:"180%",height:"220%"},s("feGaussianBlur",{stdDeviation:4,result:"b"}),s("feMerge",{},s("feMergeNode",{in:"b"}),s("feMergeNode",{in:"SourceGraphic"})));
 defs.append(glow);
 const gLinks=s("g",{class:"km-links","aria-hidden":"true"});
 const gDeps=s("g",{class:"km-deps","aria-hidden":"true"});
 const gNodes=s("g",{class:"km-nodes"});
 svg.append(defs,gLinks,gDeps,gNodes);

 const els=new Map<string,SVGElement>();
 const linkEls=new Map<string,SVGElement>();
 const status=el("span",{cls:"ka-status muted",attrs:{"aria-live":"polite"}});

 // ── состояние, не меняющее раскладку: фокус, поиск, клан ──
 let hits=new Set<string>();
 let focusId:string|null=null;
 const paintFocus=()=>{
  const path=new Set(focusId?pathTo(tree,focusId).map(n=>n.id):[]);
  const kids=new Set(focusId?(byNode.get(focusId)?.children??[]).map(c=>c.id):[]);
  svg.classList.toggle("has-focus",!!focusId);
  for(const [id,g] of els){
   g.classList.toggle("on-path",path.has(id));
   g.classList.toggle("on-kid",kids.has(id));
  }
  for(const [id,p] of linkEls)p.classList.toggle("on-path",path.has(id));
  gDeps.replaceChildren();
  if(!focusId)return;
  const here=layout.byId.get(focusId);
  if(!here)return;
  const draw=(otherId:string,incoming:boolean)=>{
   const other=layout.byId.get(otherId);
   if(!other||other===here)return;
   const a=incoming?other:here,b=incoming?here:other;
   const x1=a.x+a.w/2,y1=a.y+(b.y>=a.y?a.h/2:-a.h/2),x2=b.x+b.w/2,y2=b.y+(b.y>=a.y?-b.h/2:b.h/2);
   const bend=Math.max(60,Math.abs(x2-x1)*0.4)+Math.abs(y2-y1)*0.15;
   const d=`M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1-bend).toFixed(1)} ${y1.toFixed(1)} ${(x2-bend).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
   gDeps.append(s("path",{d,class:"km-dep "+(incoming?"is-in":"is-out"),fill:"none"}));
  };
  for(const d of o.deps[focusId]??[])draw(d,false);
  for(const d of dependents[focusId]??[])draw(d,true);
 };
 const paintFilters=()=>{
  const any=hits.size>0,iso=state.clan;
  for(const [id,g] of els){
   const n=byNode.get(id)!;
   const clanOff=iso!==null&&n.clan!==iso&&n.kind!=="trunk";
   const hitOn=any&&hits.has(id);
   g.classList.toggle("is-hit",hitOn);
   g.classList.toggle("is-dim",clanOff||(any&&!hitOn));
  }
  for(const [id,p] of linkEls){const n=byNode.get(id)!;p.classList.toggle("is-dim",iso!==null&&n.clan!==iso);}
  legend.querySelectorAll<HTMLButtonElement>("button.ka-clan").forEach(b=>b.setAttribute("aria-pressed",String(iso!==null&&Number(b.dataset.clan)===iso)));
  status.textContent=state.query.trim().length>=2?(hits.size?`Найдено: ${hits.size}. Enter — к следующему.`:"Ничего не найдено."):"";
 };

 // ── отрисовка: узлы переиспользуются и плавно переезжают на новые места ──
 const toggleNode=(n:AtlasNode)=>{
  if(!n.children.length)return;
  if(expanded.has(n.id)){
   // свёртка закрывает и всё вложенное
   expanded.delete(n.id);
   for(const d of allNodes(n))expanded.delete(d.id);
  }else expanded.add(n.id);
  state.expanded=expanded;
  render(n.id);
 };
 const makeNode=(b:MindBox):SVGElement=>{
  const n=b.node;
  const g=s("g",{class:`km-node d${Math.min(b.depth,3)} ${n.kind} st-${n.state}`,role:"treeitem",tabindex:b.depth===0?0:-1,"aria-label":`${n.label}${n.note?". "+n.note:""}`,style:`--c:${color(n)}`});
  g.dataset.id=n.id;
  const w=b.w,h=b.h;
  if(b.depth===0){
   g.append(s("rect",{class:"km-body",x:0,y:-h/2,width:w,height:h,rx:h/2}),s("text",{class:"km-emoji",x:30,y:9,"font-size":28,"text-anchor":"middle"},n.emoji??"🦊"),s("text",{class:"km-label",x:w/2+14,y:6,"text-anchor":"middle"},n.label));
  }else{
   g.append(s("rect",{class:"km-body",x:0,y:-h/2,width:w,height:h,rx:h/2}),s("circle",{class:"km-dot",cx:14,cy:0,r:4.2}));
   let tx=26;
   if(n.emoji){g.append(s("text",{class:"km-emoji",x:26,y:5,"font-size":14,"text-anchor":"middle"},n.emoji));tx=40;}
   g.append(s("text",{class:"km-label",x:tx,y:4.6},shortLabel(n.label)));
   if(n.children.length){
    const chev=s("g",{class:"km-chev",transform:`translate(${w-4} 0)`});
    chev.append(s("circle",{r:10,class:"km-chev-bg"}),s("path",{d:"M-2.6 -4 L2.6 0 L-2.6 4",class:"km-chev-mark",fill:"none"}));
    g.append(chev);
    chev.addEventListener("click",ev=>{ev.stopPropagation();toggleNode(n);});
   }
   const badge=s("g",{class:"km-badge"});
   badge.append(s("rect",{class:"km-badge-bg",x:0,y:-9,width:30,height:18,rx:9}),s("text",{class:"km-badge-t",x:15,y:4,"text-anchor":"middle"},""));
   badge.setAttribute("transform",`translate(${w+14} 0)`);
   g.append(badge);
  }
  g.append(s("title",{},n.label+(n.note?" — "+n.note:"")));
  g.addEventListener("click",()=>{if(dragMoved)return;if(n.children.length&&b.depth>0)toggleNode(n);else o.onOpen(n);});
  g.addEventListener("dblclick",ev=>{ev.preventDefault();o.onOpen(n);});
  g.addEventListener("mouseenter",()=>{focusId=n.id;paintFocus();});
  g.addEventListener("mouseleave",()=>{focusId=null;paintFocus();});
  g.addEventListener("focus",()=>{focusId=n.id;paintFocus();});
  g.addEventListener("blur",()=>{focusId=null;paintFocus();});
  g.addEventListener("keydown",ev=>onKey(ev as KeyboardEvent,n));
  return g;
 };
 const onKey=(ev:KeyboardEvent,n:AtlasNode)=>{
  const k=ev.key;
  const move=(id:string|undefined)=>{if(!id)return;const t=els.get(id);if(t){ev.preventDefault();t.setAttribute("tabindex","0");(t as unknown as HTMLElement).focus();}};
  if(k==="Enter"){ev.preventDefault();o.onOpen(n);}
  else if(k===" "){ev.preventDefault();toggleNode(n);}
  else if(k==="ArrowRight"){ev.preventDefault();if(n.children.length&&!expanded.has(n.id))toggleNode(n);else move(n.children[0]?.id);}
  else if(k==="ArrowLeft"){ev.preventDefault();if(expanded.has(n.id)&&n.children.length)toggleNode(n);else move(parentOf.get(n.id));}
  else if(k==="ArrowDown"||k==="ArrowUp"){
   const pid=parentOf.get(n.id);const sib=pid?byNode.get(pid)!.children.filter(c=>layout.byId.has(c.id)):[];
   const i=sib.findIndex(c=>c.id===n.id);move(sib[i+(k==="ArrowDown"?1:-1)]?.id);
  }
 };
 let firstRender=true;
 const render=(anchor?:string)=>{
  const prevPos=new Map([...layout.byId].map(([id,b])=>[id,b]));
  layout=layoutMind(tree,expanded);
  // уходящие узлы
  for(const [id,g] of els)if(!layout.byId.has(id)){g.classList.add("is-leaving");const gg=g;setTimeout(()=>gg.remove(),220);els.delete(id);}
  for(const [id,p] of linkEls)if(!layout.byId.has(id)){p.remove();linkEls.delete(id);}
  // дерево рисуем в порядке «слева направо», чтобы новые узлы появлялись веером от родителя
  let i=0;
  for(const b of layout.boxes.slice().sort((a,c)=>a.depth-c.depth||a.y-c.y)){
   let g=els.get(b.node.id);
   const fresh=!g;
   if(!g){g=makeNode(b);els.set(b.node.id,g);gNodes.append(g);}
   const from=fresh?(prevPos.get(b.parent??"")??null):null;
   // стартовая точка новичка — место родителя (узел «вырастает» из него)
   if(fresh&&from&&!firstRender){g.style.transform=`translate(${from.x}px,${from.y}px)`;void (g as unknown as HTMLElement).getBoundingClientRect();g.style.setProperty("--i",String(Math.min(i++,14)));g.classList.add("is-new");}
   g.style.transform=`translate(${b.x}px,${b.y}px)`;
   g.setAttribute("aria-expanded",b.node.children.length?String(expanded.has(b.node.id)):"");
   g.classList.toggle("is-open",expanded.has(b.node.id));
   const badgeT=g.querySelector<SVGTextElement>(".km-badge-t");
   const badge=g.querySelector<SVGElement>(".km-badge");
   if(badgeT&&badge){const hid=b.hidden;badge.classList.toggle("is-on",hid>0);badgeT.textContent=hid>0?`+${hid}`:"";const wBg=badge.querySelector("rect");if(wBg)wBg.setAttribute("width",String(Math.max(26,8+String(hid).length*8+8)));}
  }
  for(const l of layout.links){
   let p=linkEls.get(l.to);
   if(!p){
    p=s("path",{class:"km-link",fill:"none",style:`--c:${color(byNode.get(l.to)!)}`});
    p.setAttribute("stroke-width",String(l.depth<=1?4:l.depth===2?3:2));
    if(!firstRender)p.classList.add("is-new");
    gLinks.append(p);linkEls.set(l.to,p);
   }
   p.setAttribute("d",l.d);
   p.style.setProperty("d",`path("${l.d}")`);
  }
  firstRender=false;
  paintFocus();paintFilters();
  if(anchor){
   // карта не «убегает»: после раскрытия держим выбранный узел там, где он был на экране
   const was=prevPos.get(anchor),now=layout.byId.get(anchor);
   if(was&&now){v.x+=now.x-was.x;v.y+=now.y-was.y;}
   // раскрытые дети должны попасть в окно: двигаем карту минимально
   const kids=(byNode.get(anchor)?.children??[]).map(c=>layout.byId.get(c.id)).filter((b):b is MindBox=>!!b);
   if(kids.length&&expanded.has(anchor)){
    const top=Math.min(...kids.map(k=>k.y-k.h/2))-30,bottom=Math.max(...kids.map(k=>k.y+k.h/2))+30,right=Math.max(...kids.map(k=>k.x+k.w))+60;
    if(bottom-top<=v.h){
     if(top<v.y)v.y=top;else if(bottom>v.y+v.h)v.y=bottom-v.h;
    }else v.y=(now?.y??top)-v.h/2;
    if(right>v.x+v.w)v.x=right-v.w;
   }
   apply();
  }
 };

 // ── приближение и сдвиг: масштаб — пикселей на единицу карты, пропорции окна не меняются ──
 const MAX_SCALE=2.2,READABLE=0.6;
 const size=()=>{const r=svg.getBoundingClientRect();return {w:r.width||900,h:r.height||600};};
 const scaleOf=()=>size().w/v.w;
 const fitScale=()=>{const r=size(),b=layout.bounds;return Math.min(r.w/b.w,r.h/b.h);};
 const apply=()=>{svg.setAttribute("viewBox",[v.x,v.y,v.w,v.h].map(n=>n.toFixed(1)).join(" "));state.vb=[v.x,v.y,v.w,v.h];};
 const toWorld=(cx:number,cy:number):[number,number]=>{
  const r=svg.getBoundingClientRect();const sc=Math.min(r.width/v.w,r.height/v.h)||1;
  return [v.x+(cx-r.left-(r.width-v.w*sc)/2)/sc,v.y+(cy-r.top-(r.height-v.h*sc)/2)/sc];
 };
 const zoomAt=(f:number,cx:number,cy:number)=>{
  const lo=Math.min(fitScale(),READABLE)*0.8;
  const sc=Math.max(lo,Math.min(MAX_SCALE,scaleOf()*f));
  const r=size(),w=r.w/sc,h=r.h/sc;
  v.x=cx-(cx-v.x)*(w/v.w);v.y=cy-(cy-v.y)*(h/v.h);v.w=w;v.h=h;apply();
 };
 let dragMoved=false;
 svg.addEventListener("wheel",ev=>{ev.preventDefault();const [x,y]=toWorld(ev.clientX,ev.clientY);zoomAt(ev.deltaY<0?1.15:1/1.15,x,y);},{passive:false});
 let drag:{x:number;y:number;vx:number;vy:number}|null=null;
 svg.addEventListener("pointerdown",ev=>{if(ev.button!==0)return;drag={x:ev.clientX,y:ev.clientY,vx:v.x,vy:v.y};dragMoved=false;});
 svg.addEventListener("pointermove",ev=>{
  if(!drag)return;
  const r=svg.getBoundingClientRect();const sc=Math.min(r.width/v.w,r.height/v.h)||1;
  if(!dragMoved&&Math.abs(ev.clientX-drag.x)+Math.abs(ev.clientY-drag.y)>5){dragMoved=true;try{svg.setPointerCapture(ev.pointerId);}catch{/* указатель уже отпущен */}svg.classList.add("is-drag");}
  if(!dragMoved)return;
  v.x=drag.vx-(ev.clientX-drag.x)/sc;v.y=drag.vy-(ev.clientY-drag.y)/sc;apply();
 });
 const stop=()=>{drag=null;svg.classList.remove("is-drag");setTimeout(()=>{dragMoved=false;},0);};
 svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);
 /** Вся карта: если она слишком высокая, масштаб не меньше читаемого, а центр — корень. */
 const fit=()=>{
  const r=size(),b=layout.bounds;
  const sc=Math.max(fitScale(),READABLE);
  v.w=r.w/sc;v.h=r.h/sc;
  const rootBox=layout.byId.get(tree.id);
  v.x=b.x+b.w/2-v.w/2;
  v.y=sc>fitScale()&&rootBox?rootBox.y-v.h/2:b.y+b.h/2-v.h/2;
  apply();
 };
 const focusOn=(id:string)=>{
  const b=layout.byId.get(id);if(!b)return;
  const r=size(),sc=Math.max(1,Math.min(MAX_SCALE,scaleOf()));
  v.w=r.w/sc;v.h=r.h/sc;v.x=b.x+b.w/2-v.w/2;v.y=b.y-v.h/2;apply();
 };

 // ── панель: поиск, раскрытие, масштаб, легенда ──
 const query=el("input",{cls:"kt-search ka-search",attrs:{type:"search",placeholder:"Найти на карте: ветвь, показатель, награда, файл…","aria-label":"Поиск по карте-схеме"}});
 query.value=state.query;
 let hitIdx=0;
 const goHit=(step:number)=>{
  const list=nodes.filter(n=>hits.has(n.id));
  if(!list.length)return;
  hitIdx=(hitIdx+step+list.length)%list.length;
  focusOn(list[hitIdx]!.id);
 };
 const runSearch=()=>{
  hits=searchAtlas(tree,state.query);hitIdx=0;
  if(hits.size){expanded=revealHits(tree,hits,expanded);state.expanded=expanded;render();goHit(0);}
  else paintFilters();
 };
 query.addEventListener("input",()=>{state.query=query.value;runSearch();});
 query.addEventListener("keydown",ev=>{
  if(ev.key==="Enter"&&hits.size){ev.preventDefault();goHit(ev.shiftKey?-1:1);}
 });
 const legend=el("div",{cls:"ka-legend",attrs:{role:"group","aria-label":"Кланы ветвей: нажмите, чтобы оставить только один"}},
  ...clansInUse(tree).map(i=>{
   const b=el("button",{type:"button",cls:"ka-clan",attrs:{"aria-pressed":"false"}},el("i",{attrs:{style:`background:${clanColor(i)}`}}),CLANS[i]!.label);
   b.dataset.clan=String(i);
   b.addEventListener("click",()=>{state.clan=state.clan===i?null:i;paintFilters();});
   return b;
  }));
 const btn=(label:string,aria:string,fn:()=>void)=>{const b=el("button",{type:"button",cls:"kt-chip",textContent:label,attrs:{"aria-label":aria}});b.addEventListener("click",fn);return b;};
 const setExpanded=(set:Set<string>)=>{expanded=set;state.expanded=set;render();fit();};
 const levels=maxDepth(tree);
 const bar=el("div",{cls:"ka-bar"},query,
  el("div",{cls:"ka-zoom",attrs:{role:"group","aria-label":"Раскрытие веток"}},
   btn("Раскрыть всё","Раскрыть все ветки",()=>setExpanded(expandToDepth(tree,levels+1))),
   btn("Свернуть","Свернуть до первого уровня",()=>setExpanded(defaultExpanded(tree))),
   btn("Уровень 2","Раскрыть до второго уровня",()=>setExpanded(expandToDepth(tree,2)))),
  el("div",{cls:"ka-zoom",attrs:{role:"group","aria-label":"Масштаб"}},
   btn("−","Отдалить",()=>zoomAt(1/1.25,v.x+v.w/2,v.y+v.h/2)),
   btn("+","Приблизить",()=>zoomAt(1.25,v.x+v.w/2,v.y+v.h/2)),
   btn("Вся карта","Показать всю карту",fit)));
 const stage=el("div",{cls:"ka-stage km-stage"});stage.append(svg);
 const hint=el("p",{cls:"ka-hint muted",textContent:"Нажмите на ветвь — она раскроется, двойной щелчок или Enter — подробности. Наведите на узел: подсветится путь до корня, пунктир покажет связи «зависит от»."});
 const root=el("section",{cls:"ka-wrap km-wrap",attrs:{"aria-label":"Карта-схема"}},bar,status,legend,stage,hint);
 svg.addEventListener("keydown",ev=>{
  const k=(ev as KeyboardEvent).key;
  if(ev.target!==svg)return;
  const st=v.w*0.08;
  if(k==="ArrowLeft"){v.x-=st;apply();ev.preventDefault();}
  else if(k==="ArrowRight"){v.x+=st;apply();ev.preventDefault();}
  else if(k==="ArrowUp"){v.y-=st;apply();ev.preventDefault();}
  else if(k==="ArrowDown"){v.y+=st;apply();ev.preventDefault();}
  else if(k==="+"||k==="="){zoomAt(1.25,v.x+v.w/2,v.y+v.h/2);ev.preventDefault();}
  else if(k==="-"){zoomAt(1/1.25,v.x+v.w/2,v.y+v.h/2);ev.preventDefault();}
  else if(k==="Home"){fit();ev.preventDefault();}
 });
 render();
 if(!state.vb){fit();requestAnimationFrame(()=>{if(svg.isConnected)fit();});}
 hits=searchAtlas(tree,state.query);
 paintFilters();
 return root;
}
