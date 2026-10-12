import {el,icon,iconButton,type IconName} from "../dom";
import {CLANS,allNodes,clanColor,clansInUse,searchAtlas,type AtlasNode} from "./kitsune-atlas-model";
import {defaultExpanded,degrees,isLive,liveValue,downstreamDepths,expandToDepth,layoutMind,maxDepth,pathTo,revealHits,shortLabel,type MindBox,type MindLayout,type MindMode} from "./kitsune-mindmap-model";
import {LAYER_TEXT} from "./kitsune-sections";

/**
 * «Карта-схема»: интеллект-карта проекта. Ветви раскрываются вправо, путь до корня подсвечивается
 * бегущим свечением, связи манифеста («зависит от») показываются пунктиром при наведении.
 * Эффекты короткие и отключаются при «уменьшить движение».
 */
export interface MindState{expanded:Set<string>|null;vb:[number,number,number,number]|null;query:string;clan:number|null;mode:MindMode;selected:string|null}
export const newMindState=():MindState=>({expanded:null,vb:null,query:"",clan:null,mode:"structure",selected:null});

const NS="http://www.w3.org/2000/svg";
const s=(name:string,attrs:Record<string,string|number>={},...kids:(SVGElement|string)[])=>{
 const n=document.createElementNS(NS,name);
 for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
 for(const k of kids)n.append(k);
 return n as SVGElement;
};
const MIN_ZOOM=0.3,MAX_ZOOM=3;

/** Дуга зависимости от одного узла к другому: выходит сбоку, чтобы не слипаться с ветвями дерева. */
function depCurve(a:MindBox,b:MindBox):string{
 const down=b.y>=a.y;
 const x1=a.x+a.w/2,y1=a.y+(down?a.h/2:-a.h/2),x2=b.x+b.w/2,y2=b.y+(down?-b.h/2:b.h/2);
 const bend=Math.max(60,Math.abs(x2-x1)*0.4)+Math.abs(y2-y1)*0.15;
 const f=(n:number)=>n.toFixed(1);
 return `M${f(x1)} ${f(y1)} C${f(x1-bend)} ${f(y1)} ${f(x2-bend)} ${f(y2)} ${f(x2)} ${f(y2)}`;
}
export interface MindOptions{
 tree:AtlasNode;state:MindState;onOpen:(n:AtlasNode)=>void;
 /** id узла → id узлов, от которых он зависит (из манифеста) */
 deps:Record<string,string[]>;
 /** id узла → номер этапа (для слоя «Этапы») */
 stages:Record<string,number>;
}
const MODE_ICON:Record<MindMode,IconName>={structure:"modules",links:"link",stages:"rows",impact:"alert"};
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
 const depNodes=Object.entries(o.deps).map(([id,dependsOn])=>({id,dependsOn}));
 const isManifest=(id:string)=>id in o.deps;
 const deg=degrees(depNodes);
 const gAll=s("g",{class:"km-deps-all","aria-hidden":"true"});
 svg.insertBefore(gAll,gDeps);

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
   gDeps.append(s("path",{d:incoming?depCurve(other,here):depCurve(here,other),class:"km-dep "+(incoming?"is-in":"is-out"),fill:"none"}));
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
   const live=liveValue(n);
   if(live){
    const vw=10+live.length*7.4;
    g.append(s("rect",{class:"km-val-bg",x:w-vw-6,y:-9,width:vw,height:18,rx:9}),s("text",{class:"km-val",x:w-6-vw/2,y:4,"text-anchor":"middle"},live));
   }
   if(isLive(n))g.classList.add("is-live");
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
  g.append(s("g",{class:"km-extra"}));
  g.append(s("title",{},n.label+(n.note?" — "+n.note:"")));
  g.addEventListener("click",()=>{
   if(dragMoved)return;
   if(state.mode==="impact"&&isManifest(n.id)){selectSource(n.id);return;}
   if(n.children.length&&b.depth>0)toggleNode(n);else o.onOpen(n);
  });
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

 // ── слои: структура, связи, этапы, «что сломается, если…» ──
 let impact=new Map<string,number>();
 const impactPanel=el("section",{cls:"kt-impact km-impact",attrs:{"aria-label":"Что сломается"}});
 const lead=el("p",{cls:"km-lead muted"});
 const modeButtons:[MindMode,HTMLButtonElement][]=(["structure","links","stages","impact"] as MindMode[]).map(m=>{
  const b=el("button",{type:"button",cls:"km-mode",title:LAYER_TEXT[m].lead,attrs:{"aria-pressed":"false"}},icon(MODE_ICON[m],16),el("span",{textContent:m==="impact"?"Что сломается":LAYER_TEXT[m].title}));
  b.addEventListener("click",()=>setMode(m));
  return [m,b];
 });
 const paintMode=()=>{
  const m=state.mode;
  svg.classList.remove("mode-structure","mode-links","mode-stages","mode-impact");svg.classList.add("mode-"+m);
  lead.textContent=LAYER_TEXT[m].lead;
  for(const [k,b] of modeButtons)b.setAttribute("aria-pressed",String(k===m));
  impact=m==="impact"&&state.selected&&isManifest(state.selected)?downstreamDepths(depNodes,state.selected):new Map();
  gAll.replaceChildren();
  for(const [id,g] of els){
   const extra=g.querySelector<SVGElement>(".km-extra");
   g.classList.toggle("is-source",m==="impact"&&state.selected===id);
   g.classList.toggle("in-impact",m==="impact"&&impact.has(id));
   if(!extra)continue;
   extra.replaceChildren();
   const b=layout.byId.get(id);
   if(!b||!isManifest(id))continue;
   if(m==="links"){const d=deg.get(id);if(d)extra.append(s("text",{class:"km-deg",x:b.w/2,y:b.h/2+13,"text-anchor":"middle"},`↑${d.up}  ↓${d.down}`));}
   if(m==="stages"&&id in o.stages)extra.append(s("circle",{class:"km-badge-dot",cx:-2,cy:-b.h/2+2,r:10}),s("text",{class:"km-badge-num",x:-2,y:-b.h/2+6,"text-anchor":"middle"},String(o.stages[id])));
   if(m==="impact"&&impact.has(id))extra.append(s("circle",{class:"km-badge-dot is-step",cx:b.w+4,cy:-b.h/2+2,r:10}),s("text",{class:"km-badge-num",x:b.w+4,y:-b.h/2+6,"text-anchor":"middle"},String(impact.get(id))));
  }
  if(m==="links"){
   for(const b of layout.boxes)for(const dep of o.deps[b.node.id]??[]){
    const to=layout.byId.get(dep);
    if(to&&to!==b)gAll.append(s("path",{d:depCurve(b,to),class:"km-dep is-out",fill:"none"}));
   }
  }
  impactPanel.hidden=m!=="impact";
  if(m==="impact"){
   const src=state.selected?byNode.get(state.selected):undefined;
   const list=[...impact.entries()].map(([id,d])=>({n:byNode.get(id)!,d})).filter(x=>x.n).sort((a,b)=>a.d-b.d||a.n.label.localeCompare(b.n.label,"ru"));
   const details=el("button",{type:"button",cls:"kt-chip",textContent:"Сведения о ветви «"+(src?.label??"")+"»"});
   details.addEventListener("click",()=>{if(src)o.onOpen(src);});
   impactPanel.replaceChildren(
    el("h3",{textContent:src?`Если сломается «${src.label}»`:"Выберите ветвь"}),
    list.length?el("ul",{cls:"kt-impact-list"},...list.map(x=>el("li",{},el("strong",{textContent:x.n.label}),el("small",{cls:"muted",textContent:(x.d===1?"зависит напрямую":"через "+x.d+" "+(x.d<5?"шага":"шагов"))+(x.n.state==="planned"?" · запланировано":"")})))):el("p",{cls:"muted",textContent:"От этой ветви пока ничего не зависит."}),
    el("p",{cls:"muted",textContent:"Это структурный анализ карты, а не прогноз фактического сбоя."}),details);
  }
 };
 /** Показать выбранные узлы целиком: масштаб подбирается так, чтобы они поместились, но не мельче читаемого. */
 const showBoxes=(ids:string[])=>{
  const boxes=ids.map(i=>layout.byId.get(i)).filter((b):b is MindBox=>!!b);
  if(!boxes.length)return;
  const r=size();
  const minX=Math.min(...boxes.map(b=>b.x)),maxX=Math.max(...boxes.map(b=>b.x+b.w));
  const minY=Math.min(...boxes.map(b=>b.y-b.h/2)),maxY=Math.max(...boxes.map(b=>b.y+b.h/2));
  const w=maxX-minX+200,h=maxY-minY+140;
  const sc=Math.max(READABLE,Math.min(r.w/w,r.h/h,1.3));
  v.w=r.w/sc;v.h=r.h/sc;v.x=(minX+maxX)/2-v.w/2;v.y=(minY+maxY)/2-v.h/2;apply();
 };
 const manifestIds=Object.keys(o.deps).filter(id=>byNode.has(id));
 /** Для слоёв модулей раскрываем всё, что связано с манифестом: показатели, награды и код остаются свёрнутыми. */
 const expandModules=()=>{
  for(const id of manifestIds){const n=byNode.get(id)!;if(n.children.some(c=>isManifest(c.id)))expanded.add(id);}
  state.expanded=expanded;
 };
 const selectSource=(id:string)=>{
  state.selected=id;
  const down=downstreamDepths(depNodes,id);
  expanded=revealHits(tree,new Set([id,...down.keys()]),expanded);state.expanded=expanded;
  render();
  showBoxes([id,...down.keys()]);
 };
 const setMode=(m:MindMode)=>{
  state.mode=m;
  if(m!=="structure")expandModules();
  if(m==="impact"&&!(state.selected&&isManifest(state.selected))){
   // по умолчанию — модуль, от которого зависит больше всего других (кроме корня)
   const best=depNodes.filter(n=>n.id!==tree.id).map(n=>({id:n.id,k:downstreamDepths(depNodes,n.id).size})).sort((a,b)=>b.k-a.k)[0];
   if(best){selectSource(best.id);return;}
  }
  render();
  if(m!=="structure")showBoxes(manifestIds);
  else fit();
 };
 // ── мини-карта: вся карта точками и рамка текущего вида; клик и перетаскивание двигают вид ──
 const MM_W=176,MM_H=112;
 const mini=s("svg",{class:"km-mini",viewBox:`0 0 ${MM_W} ${MM_H}`,role:"presentation"}) as SVGSVGElement;
 const miniBody=s("g",{});const miniFrame=s("rect",{class:"km-mini-view",rx:2});
 mini.append(miniBody,miniFrame);
 const miniScale=()=>{const b=layout.bounds;const sc=Math.min(MM_W/b.w,MM_H/b.h);return {b,sc,ox:(MM_W-b.w*sc)/2,oy:(MM_H-b.h*sc)/2};};
 const paintMiniBody=()=>{
  const {b,sc,ox,oy}=miniScale();
  miniBody.replaceChildren(...layout.boxes.map(bx=>s("rect",{x:((bx.x-b.x)*sc+ox).toFixed(1),y:(((bx.y-bx.h/2)-b.y)*sc+oy).toFixed(1),width:Math.max(2.5,bx.w*sc).toFixed(1),height:Math.max(1.6,bx.h*sc).toFixed(1),rx:.8,fill:color(bx.node)})));
  mini.classList.toggle("is-small",layout.boxes.length<=14);
 };
 const paintMiniFrame=()=>{
  const {b,sc,ox,oy}=miniScale();
  miniFrame.setAttribute("x",((v.x-b.x)*sc+ox).toFixed(1));miniFrame.setAttribute("y",((v.y-b.y)*sc+oy).toFixed(1));
  miniFrame.setAttribute("width",(v.w*sc).toFixed(1));miniFrame.setAttribute("height",(v.h*sc).toFixed(1));
 };
 const moveFromMini=(ev:PointerEvent)=>{
  const r=mini.getBoundingClientRect();const {b,sc,ox,oy}=miniScale();
  const px=(ev.clientX-r.left)/r.width*MM_W,py=(ev.clientY-r.top)/r.height*MM_H;
  v.x=b.x+(px-ox)/sc-v.w/2;v.y=b.y+(py-oy)/sc-v.h/2;apply();
 };
 let miniDrag=false;
 mini.addEventListener("pointerdown",ev=>{ev.stopPropagation();miniDrag=true;try{mini.setPointerCapture(ev.pointerId);}catch{/* указатель уже отпущен */}moveFromMini(ev);});
 mini.addEventListener("pointermove",ev=>{if(miniDrag)moveFromMini(ev);});
 const miniStop=()=>{miniDrag=false;};
 mini.addEventListener("pointerup",miniStop);mini.addEventListener("pointercancel",miniStop);
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
  paintMiniBody();
  paintFocus();paintFilters();paintMode();
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
 const apply=()=>{svg.setAttribute("viewBox",[v.x,v.y,v.w,v.h].map(n=>n.toFixed(1)).join(" "));state.vb=[v.x,v.y,v.w,v.h];paintMiniFrame();};
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
 const query=el("input",{cls:"kt-search ka-search",attrs:{type:"search",placeholder:"Найти ветвь, показатель, награду, файл…","aria-label":"Поиск по карте-схеме"}});
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
   const b=el("button",{type:"button",cls:"ka-clan",title:CLANS[i]!.label,attrs:{"aria-pressed":"false"}},el("i",{attrs:{style:`background:${clanColor(i)}`}}),el("span",{cls:"ka-clan-t",textContent:CLANS[i]!.label}));
   b.dataset.clan=String(i);
   b.addEventListener("click",()=>{state.clan=state.clan===i?null:i;paintFilters();});
   return b;
  }));
 const tool=(name:IconName,label:string,fn:()=>void)=>iconButton(name,label,()=>fn(),"km-ib");
 const textTool=(text:string,label:string,fn:()=>void)=>{const b=el("button",{type:"button",cls:"km-ib",textContent:text,title:label,attrs:{"aria-label":label}});b.addEventListener("click",fn);return b;};
 const setExpanded=(set:Set<string>)=>{expanded=set;state.expanded=set;render();fit();};
 const levels=maxDepth(tree);
 const bar=el("div",{cls:"km-toolbar"},
  el("div",{cls:"km-seg",attrs:{role:"group","aria-label":"Слой карты"}},...modeButtons.map(x=>x[1])),
  el("div",{cls:"km-search"},icon("search",16),query),
  el("div",{cls:"km-tools",attrs:{role:"group","aria-label":"Раскрытие и масштаб"}},
   tool("maximize","Раскрыть все ветки",()=>setExpanded(expandToDepth(tree,levels+1))),
   tool("list","Раскрыть до второго уровня",()=>setExpanded(expandToDepth(tree,2))),
   tool("minimize","Свернуть до первого уровня",()=>setExpanded(defaultExpanded(tree))),
   el("span",{cls:"km-sep"}),
   textTool("−","Отдалить",()=>zoomAt(1/1.25,v.x+v.w/2,v.y+v.h/2)),
   textTool("+","Приблизить",()=>zoomAt(1.25,v.x+v.w/2,v.y+v.h/2)),
   tool("target","Показать всю карту",fit)));
 const stage=el("div",{cls:"ka-stage km-stage"});stage.append(svg,legend,mini);
 legend.classList.add("km-legend-ov");
 const root=el("section",{cls:"ka-wrap km-wrap",attrs:{"aria-label":"Карта-схема"}},bar,lead,status,stage,impactPanel);
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
