/**
 * «Атлас» — большое дерево в стиле плаката: толстый ствол внизу, цветные ветви-кланы, на концах хабы с венцами листьев.
 * Здесь только данные и раскладка (без DOM): всё строится из реальных источников, ничего не выдумывается.
 */
export type AtlasKind="trunk"|"branch"|"hub"|"leaf";
export type AtlasState="ok"|"planned"|"empty"|"bad"|"info";
export interface AtlasRef{type:"root"|"manifest"|"clan"|"world"|"metric"|"medalGroup"|"medal"|"code"|"module"|"history";key:string}
export interface AtlasNode{
 id:string;label:string;kind:AtlasKind;clan:number;emoji?:string;state:AtlasState;note?:string;ref:AtlasRef;children:AtlasNode[];
}
export interface Clan{id:string;label:string;hue:number;sat:number}
export const CLANS:Clan[]=[
 {id:"brain",label:"Мозг и развитие",hue:28,sat:78},
 {id:"tasks",label:"Дела",hue:196,sat:62},
 {id:"disk",label:"Диск",hue:148,sat:52},
 {id:"forest",label:"Лес показателей",hue:96,sat:50},
 {id:"awards",label:"Награды",hue:46,sat:78},
 {id:"modules",label:"Модули",hue:268,sat:46},
 {id:"updates",label:"Обновления",hue:330,sat:62},
 {id:"code",label:"Код проекта",hue:214,sat:34},
 {id:"kitsune",label:"Лисье древо",hue:8,sat:72},
 {id:"other",label:"Прочее",hue:40,sat:8},
];
const CLAN_INDEX=Object.fromEntries(CLANS.map((c,i)=>[c.id,i])) as Record<string,number>;
export const clanColor=(clan:number,light=58)=>{const c=CLANS[clan]??CLANS[CLANS.length-1]!;return `hsl(${c.hue} ${c.sat}% ${light}%)`;};

const MANIFEST_CLAN:Record<string,string>={brain:"brain",tasks:"tasks",disk:"disk",kitsune:"kitsune"};
const MANIFEST_EMOJI:Record<string,string>={core:"⚙️",brain:"🧠",memory:"💾",search:"🔎",strategy:"♟️",benchmark:"🧪",tasks:"✅",disk:"📁",agent:"🛡️",kitsune:"🦊",evolution3:"🌱"};

export interface AtlasInput{
 nodes:{id:string;title:string;status:"implemented"|"planned";dependsOn:string[]}[];
 metrics:{id:string;name:string;world:number;emoji:string;value:number|null;description?:string}[];
 worlds:{emoji:string;title:string}[];
 medals:{id:string;title:string;emoji:string;group:string;earned:boolean;progress:number}[];
 code?:{id:string;file:string}[];
 modules?:{name:string;title?:string;status:string}[];
 history?:{id:string;kind:string;to:string;at:string;label:string}[];
}
export const MAX_LEAVES_PER_HUB=16;
export const MAX_CODE_HUBS=14;
const node=(id:string,label:string,kind:AtlasKind,clan:number,state:AtlasState,ref:AtlasRef,o:Partial<AtlasNode>={}):AtlasNode=>({id,label,kind,clan,state,ref,children:[],...o});

/** Ветви манифеста: родитель — первая зависимость; ядро — корень (ствол). */
function manifestBranches(input:AtlasInput):{core:AtlasNode|null;branches:AtlasNode[]}{
 const ids=new Set(input.nodes.map(n=>n.id));
 const core=input.nodes.find(n=>n.dependsOn.filter(d=>ids.has(d)).length===0&&n.id==="core")??input.nodes.find(n=>n.dependsOn.filter(d=>ids.has(d)).length===0);
 const made=new Map<string,AtlasNode>();
 const clanOf=(id:string,parent:AtlasNode|null)=>parent?parent.clan:(CLAN_INDEX[MANIFEST_CLAN[id]??"brain"]??0);
 const parentOf=(n:AtlasInput["nodes"][number])=>n.dependsOn.find(d=>ids.has(d));
 // Порядок обработки: родитель всегда раньше потомка (а циклов в манифесте нет).
 const order:AtlasInput["nodes"]=[];
 const seen=new Set<string>();
 const visit=(n:AtlasInput["nodes"][number],stack:Set<string>)=>{
  if(seen.has(n.id)||stack.has(n.id))return;
  stack.add(n.id);
  const p=parentOf(n);if(p){const pn=input.nodes.find(x=>x.id===p);if(pn)visit(pn,stack);}
  stack.delete(n.id);seen.add(n.id);order.push(n);
 };
 for(const n of input.nodes)visit(n,new Set());
 const branches:AtlasNode[]=[];
 for(const n of order){
  if(core&&n.id===core.id)continue;
  const pid=parentOf(n);
  const parent=pid&&pid!==core?.id?made.get(pid)??null:null;
  const clan=clanOf(n.id,parent);
  const a=node("m:"+n.id,n.title,parent?"hub":"branch",clan,n.status==="planned"?"planned":"ok",{type:"manifest",key:n.id},{...(MANIFEST_EMOJI[n.id]?{emoji:MANIFEST_EMOJI[n.id]!}:{}),note:n.status==="planned"?"Запланировано":"Подтверждено"});
  made.set(n.id,a);
  if(parent)parent.children.push(a);else branches.push(a);
 }
 return {core:core?node("root","JUUNIBI","trunk",CLAN_INDEX.other!,"ok",{type:"manifest",key:core.id},{emoji:"🦊"}):null,branches};
}
const chunkCap=<T,>(items:T[],cap:number)=>({shown:items.slice(0,cap),rest:Math.max(0,items.length-cap)});
const firstToken=(id:string)=>id.split("-")[0]!;

export function buildAtlas(input:AtlasInput):AtlasNode{
 const {core,branches}=manifestBranches(input);
 const root=core??node("root","JUUNIBI","trunk",CLAN_INDEX.other!,"ok",{type:"root",key:"root"},{emoji:"🦊"});
 root.children.push(...branches);
 // Лес показателей: 10 миров × 10 листьев.
 const forest=node("c:forest","Лес показателей","branch",CLAN_INDEX.forest!,"ok",{type:"clan",key:"forest"},{emoji:"🌳"});
 input.worlds.forEach((w,i)=>{
  const list=input.metrics.filter(m=>m.world===i);
  if(!list.length)return;
  const hub=node("w:"+i,w.title,"hub",forest.clan,list.some(m=>m.value!==null)?"ok":"empty",{type:"world",key:String(i)},{emoji:w.emoji,note:`Подтверждено ${list.filter(m=>m.value!==null).length} из ${list.length}`});
  hub.children=list.slice(0,MAX_LEAVES_PER_HUB).map(m=>node("x:"+m.id,m.name,"leaf",forest.clan,m.value===null?"empty":"ok",{type:"metric",key:m.id},{emoji:m.emoji,note:m.value===null?"Нет данных":String(m.value)}));
  forest.children.push(hub);
 });
 // Награды: группы из вызывающего кода (темы, особые, хранители по мирам).
 const awards=node("c:awards","Награды","branch",CLAN_INDEX.awards!,"ok",{type:"clan",key:"awards"},{emoji:"🏅"});
 const groups=new Map<string,AtlasInput["medals"]>();
 for(const m of input.medals)(groups.get(m.group)??groups.set(m.group,[]).get(m.group)!).push(m);
 for(const [group,list] of groups){
  const earned=list.filter(m=>m.earned).length;
  const hub=node("g:"+group,group,"hub",awards.clan,earned?"ok":"empty",{type:"medalGroup",key:group},{note:`Получено ${earned} из ${list.length}`});
  hub.children=list.slice(0,MAX_LEAVES_PER_HUB).map(m=>node("a:"+m.id,m.title,"leaf",awards.clan,m.earned?"ok":m.progress>0?"info":"empty",{type:"medal",key:m.id},{emoji:m.emoji,note:m.earned?"Получена":m.progress>0?Math.round(m.progress*100)+"%":"Закрыта"}));
  awards.children.push(hub);
 }
 // Модули.
 const modules=node("c:modules","Модули","branch",CLAN_INDEX.modules!,"ok",{type:"clan",key:"modules"},{emoji:"🧩"});
 if(input.modules?.length){
  const hub=node("h:modules","Работающие части","hub",modules.clan,"ok",{type:"clan",key:"modules"});
  hub.children=input.modules.slice(0,MAX_LEAVES_PER_HUB).map(m=>node("mod:"+m.name,m.title??m.name,"leaf",modules.clan,m.status==="started"||m.status==="running"?"ok":m.status==="failed"?"bad":"empty",{type:"module",key:m.name},{note:m.status}));
  modules.children.push(hub);
 }
 // Обновления.
 const updates=node("c:updates","Обновления","branch",CLAN_INDEX.updates!,"ok",{type:"clan",key:"updates"},{emoji:"⬇️"});
 if(input.history?.length){
  const hub=node("h:updates","Установки и откаты","hub",updates.clan,"ok",{type:"clan",key:"updates"});
  hub.children=input.history.slice(0,MAX_LEAVES_PER_HUB).map(h=>node("u:"+h.id,h.label,"leaf",updates.clan,h.kind==="install"?"ok":h.kind==="rollback"?"info":"bad",{type:"history",key:h.id},{note:h.kind}));
  updates.children.push(hub);
 }
 // Код: области по первому слову имени файла.
 const code=node("c:code","Код проекта","branch",CLAN_INDEX.code!,"ok",{type:"clan",key:"code"},{emoji:"📦"});
 if(input.code?.length){
  const areas=new Map<string,AtlasInput["code"]>();
  for(const f of input.code)(areas.get(firstToken(f.id))??areas.set(firstToken(f.id),[]).get(firstToken(f.id))!)!.push(f);
  const sorted=[...areas.entries()].sort((a,b)=>b[1]!.length-a[1]!.length||a[0].localeCompare(b[0]));
  const big=sorted.filter(([,v])=>v!.length>=2).slice(0,MAX_CODE_HUBS-1);
  const other=sorted.filter(e=>!big.includes(e)).flatMap(([,v])=>v!);
  const addHub=(name:string,files:NonNullable<AtlasInput["code"]>)=>{
   const {shown,rest}=chunkCap(files,MAX_LEAVES_PER_HUB-1);
   const hub=node("k:"+name,name,"hub",code.clan,"ok",{type:"code",key:"area:"+name},{note:`Файлов: ${files.length}`});
   hub.children=shown.map(f=>node("f:"+f.file,f.id,"leaf",code.clan,"info",{type:"code",key:f.file},{note:f.file}));
   if(rest)hub.children.push(node("f:"+name+":rest",`+${rest}`,"leaf",code.clan,"info",{type:"code",key:"area:"+name},{note:`Ещё файлов: ${rest}`}));
   code.children.push(hub);
  };
  for(const [name,files] of big)addHub(name,files!);
  if(other.length)addHub("прочее",other);
 }
 for(const c of [forest,awards,modules,updates,code])if(c.children.length)root.children.push(c);
 return root;
}

// ───────── раскладка ─────────
export interface Placed{node:AtlasNode;x:number;y:number;depth:number;parent:string|null;/** радиус «кластера» (хаб с венцом) */cluster:number;/** направление от ствола (радианы, 0 — вправо, π/2 — вверх) */angle:number}
export interface AtlasEdge{from:string;to:string;depth:number;clan:number;d:string}
export interface AtlasLeaf{id:string;x:number;y:number;hub:string}
export interface AtlasLayout{placed:Map<string,Placed>;leaves:AtlasLeaf[];edges:AtlasEdge[];bounds:{x:number;y:number;w:number;h:number}}
const LEAF_GAP=23;

export const countLeaves=(n:AtlasNode):number=>n.children.length?n.children.reduce((s,c)=>s+countLeaves(c),0):1;
const leafKids=(n:AtlasNode)=>n.children.filter(c=>c.kind==="leaf");
const hubKids=(n:AtlasNode)=>n.children.filter(c=>c.kind!=="leaf");
/** Радиус венца: листья по кругу с зазором LEAF_GAP. */
export function clusterRadius(n:AtlasNode):number{
 const L=leafKids(n).length;
 const ring=L?Math.max(30,L*LEAF_GAP/(2*Math.PI)):0;
 const base=n.kind==="trunk"?54:n.kind==="branch"?30:20;
 return Math.max(base,ring+16);
}
const sizeOf=(n:AtlasNode):number=>1+n.children.reduce((s,c)=>s+(c.kind==="leaf"?0.35:sizeOf(c)),0);
const FAN_START=Math.PI*0.04,FAN_END=Math.PI*0.96;

/**
 * Лучевая раскладка, как на плакате: ствол внизу, ветви веером вверх, каждый уровень на своём кольце.
 * Угол ветви пропорционален размеру её поддерева; радиус кольца берётся так, чтобы кластеры помещались в свою дугу.
 * После этого пересекающиеся кластеры разводятся, а каждый хаб мягко тянется к своему месту.
 */
export function layoutAtlas(root:AtlasNode):AtlasLayout{
 const placed=new Map<string,Placed>();
 const order:Placed[]=[];
 const make=(n:AtlasNode,depth:number,parent:string|null,angle:number)=>{
  const p:Placed={node:n,x:0,y:0,depth,parent,cluster:clusterRadius(n),angle};
  placed.set(n.id,p);order.push(p);return p;
 };
 const rootP=make(root,0,null,Math.PI/2);
 // 1) углы: дерево делится веером по размеру поддеревьев
 const span=new Map<string,[number,number]>();
 const assign=(n:AtlasNode,a0:number,a1:number,depth:number)=>{
  const kids=hubKids(n);
  if(!kids.length)return;
  const weights=kids.map(k=>Math.max(Math.pow(sizeOf(k),0.8),depth===1?6:1));
  const total=weights.reduce((a,b)=>a+b,0);
  let cursor=a0;
  kids.forEach((k,i)=>{
   const w=(a1-a0)*weights[i]!/total;
   const mid=cursor+w/2;
   span.set(k.id,[cursor,cursor+w]);cursor+=w;
   const p=make(k,depth,n.id,mid);
   assign(k,cursor-w,cursor,depth+1);
   void p;
  });
 };
 assign(root,FAN_START,FAN_END,1);
 // 2) радиусы колец: на первом кольце ветви помещаются в свои дуги, дальше кольца идут друг за другом без наложения
 const byDepth=new Map<number,Placed[]>();
 for(const p of order.slice(1))(byDepth.get(p.depth)??byDepth.set(p.depth,[]).get(p.depth)!).push(p);
 const maxDepth=Math.max(0,...byDepth.keys());
 const ringFor=(depth:number)=>(byDepth.get(depth)??[]).reduce((m,p)=>Math.max(m,p.cluster),0);
 const children=(id:string)=>order.filter(q=>q.parent===id);
 let r1=300;
 for(const p of byDepth.get(1)??[]){
  const [a0,a1]=span.get(p.node.id)!;
  const need=Math.max(2*p.cluster+60,children(p.node.id).reduce((sum,c)=>sum+2*c.cluster+50,0)*0.8);
  r1=Math.max(r1,need/Math.max(0.05,a1-a0));
 }
 r1=Math.min(r1,1000);
 const R:number[]=[0,r1];
 for(let d=2;d<=maxDepth;d++)R[d]=R[d-1]!+ringFor(d-1)+ringFor(d)+120;
 const target=new Map<string,[number,number]>();
 for(const p of order.slice(1)){
  const r=R[p.depth]!;
  p.x=Math.cos(p.angle)*r;p.y=-Math.sin(p.angle)*r;
  target.set(p.node.id,[p.x,p.y]);
 }
 // 3) разведение пересекающихся кластеров
 const hubs=order.slice(1);
 for(let iter=0;iter<260;iter++){
  for(let i=0;i<hubs.length;i++)for(let j=i+1;j<hubs.length;j++){
   const a=hubs[i]!,b=hubs[j]!;
   const family=a.parent===b.node.id||b.parent===a.node.id;
   const need=family?(a.cluster+b.cluster)*0.5+60:(a.cluster+b.cluster)*1.0+44;
   let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
   if(d>=need)continue;
   if(d<1e-6){dx=Math.cos(i*2.399);dy=Math.sin(i*2.399);d=1;}
   const push=(need-d)/2/d;
   a.x-=dx*push;a.y-=dy*push;b.x+=dx*push;b.y+=dy*push;
  }
  for(const h of hubs){
   const [tx,ty]=target.get(h.node.id)!;
   h.x+=(tx-h.x)*0.02;h.y+=(ty-h.y)*0.02;
   if(h.y>-30)h.y=-30; // ничего не уходит ниже ствола
  }
 }
 for(const h of hubs){h.x=Math.round(h.x*10)/10;h.y=Math.round(h.y*10)/10;}
 // 4) листья вокруг своего хаба, мимо направления на родителя
 const leaves:AtlasLeaf[]=[];
 for(const p of order){
  const kids=leafKids(p.node);
  if(!kids.length)continue;
  const parent=p.parent?placed.get(p.parent):rootP;
  const toParent=parent&&parent!==p?Math.atan2(-(parent.y-p.y),parent.x-p.x):-Math.PI/2;
  const gap=p.parent?0.9:0;
  const start=toParent+gap/2,arc=Math.PI*2-gap;
  const ringR=Math.max(30,kids.length*LEAF_GAP/(2*Math.PI));
  kids.forEach((k,i)=>{
   const ang=kids.length===1?toParent+Math.PI:start+arc*(i+0.5)/kids.length;
   leaves.push({id:k.id,x:Math.round((p.x+Math.cos(ang)*ringR)*10)/10,y:Math.round((p.y-Math.sin(ang)*ringR)*10)/10,hub:p.node.id});
  });
 }
 // 5) ветви: плавные кривые вдоль направления роста
 const edges:AtlasEdge[]=hubs.map(h=>{
  const p=placed.get(h.parent!)!;
  const len=Math.hypot(h.x-p.x,h.y-p.y)*0.45;
  const c1x=p.x+Math.cos(p.parent?p.angle:h.angle)*len,c1y=p.y-Math.sin(p.parent?p.angle:h.angle)*len;
  const c2x=h.x-Math.cos(h.angle)*len,c2y=h.y+Math.sin(h.angle)*len;
  const f=(n:number)=>n.toFixed(1);
  return {from:p.node.id,to:h.node.id,depth:h.depth,clan:h.node.clan,d:`M${f(p.x)} ${f(p.y)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(h.x)} ${f(h.y)}`};
 });
 let minX=-120,maxX=120,minY=-80,maxY=170;
 for(const p of order){minX=Math.min(minX,p.x-p.cluster-40);maxX=Math.max(maxX,p.x+p.cluster+40);minY=Math.min(minY,p.y-p.cluster-40);maxY=Math.max(maxY,p.y+p.cluster+60);}
 return {placed,leaves,edges,bounds:{x:minX,y:minY,w:maxX-minX,h:maxY-minY}};
}

// ───────── поиск ─────────
const fold=(s:string)=>s.toLocaleLowerCase("ru").replace(/ё/g,"е").trim();
/** Идентификаторы узлов, чьё название или пояснение содержит запрос; пустой запрос — пустой набор. */
export function searchAtlas(root:AtlasNode,query:string):Set<string>{
 const q=fold(query);
 const hits=new Set<string>();
 if(q.length<2)return hits;
 const walk=(n:AtlasNode)=>{
  if(fold(n.label).includes(q)||(n.note&&fold(n.note).includes(q)))hits.add(n.id);
  n.children.forEach(walk);
 };
 walk(root);
 return hits;
}
export function allNodes(root:AtlasNode):AtlasNode[]{return [root,...root.children.flatMap(allNodes)];}
/** Кланы, у которых есть хотя бы один узел (для легенды). */
export function clansInUse(root:AtlasNode):number[]{
 return [...new Set(allNodes(root).filter(n=>n.kind!=="trunk").map(n=>n.clan))].sort((a,b)=>a-b);
}
