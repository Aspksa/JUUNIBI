import type {AtlasNode} from "./kitsune-atlas-model";

/**
 * «Карта-схема» — интеллект-карта: корень слева, ветви раскрываются вправо.
 * Здесь только раскладка и работа с раскрытыми ветвями (без DOM): тот же состав узлов, что и в «Атласе».
 */
export interface MindBox{node:AtlasNode;x:number;y:number;w:number;h:number;depth:number;parent:string|null;/** сколько узлов скрыто под свёрнутой веткой */hidden:number}
export interface MindLink{from:string;to:string;clan:number;depth:number;d:string}
export interface MindLayout{boxes:MindBox[];links:MindLink[];byId:Map<string,MindBox>;bounds:{x:number;y:number;w:number;h:number}}

export const ROW_H=38,BOX_H=30,COL_GAP=84,GROUP_GAP=16,ROOT_W=150,ROOT_H=56;
const CHAR_W=7.7,PAD=34;
export const MAX_LABEL=30;

export const shortLabel=(s:string)=>s.length>MAX_LABEL?s.slice(0,MAX_LABEL-1)+"…":s;
/** Живое значение на листе: у подтверждённого показателя — число из данных. */
export const liveValue=(n:AtlasNode):string|null=>n.kind==="leaf"&&n.ref.type==="metric"&&n.state==="ok"&&n.note?n.note:null;
/** Лист «работает прямо сейчас»: запущенный модуль. */
export const isLive=(n:AtlasNode):boolean=>n.kind==="leaf"&&n.ref.type==="module"&&n.state==="ok";
const sizeOfNode=(n:AtlasNode,depth:number)=>{
 if(depth===0)return {w:ROOT_W,h:ROOT_H};
 const text=shortLabel(n.label).length*(depth===1?8.7:CHAR_W);
 const value=liveValue(n);
 return {w:Math.round(PAD+(n.emoji?18:0)+text+(n.children.length?22:0)+(value?14+value.length*7.4:0)),h:depth===1?BOX_H+6:BOX_H};
};
export const countBelow=(n:AtlasNode):number=>n.children.reduce((s,c)=>s+1+countBelow(c),0);

/** По умолчанию раскрыты корень и первый уровень: видны все ветви и их хабы свёрнуты. */
export function defaultExpanded(root:AtlasNode):Set<string>{
 return new Set([root.id]);
}
/** Раскрыть всё до заданной глубины (0 — только корень). */
export function expandToDepth(root:AtlasNode,depth:number):Set<string>{
 const out=new Set<string>();
 const walk=(n:AtlasNode,d:number)=>{if(d<depth&&n.children.length){out.add(n.id);n.children.forEach(c=>walk(c,d+1));}};
 walk(root,0);
 return out;
}
export const maxDepth=(n:AtlasNode):number=>n.children.length?1+Math.max(...n.children.map(maxDepth)):0;
/** Цепочка предков от корня до узла (включая узел) или пусто, если такого узла нет. */
export function pathTo(root:AtlasNode,id:string):AtlasNode[]{
 const walk=(n:AtlasNode,acc:AtlasNode[]):AtlasNode[]|null=>{
  const here=[...acc,n];
  if(n.id===id)return here;
  for(const c of n.children){const r=walk(c,here);if(r)return r;}
  return null;
 };
 return walk(root,[])??[];
}
/** Раскрыть предков найденных узлов, чтобы их было видно. */
export function revealHits(root:AtlasNode,hits:Set<string>,base:Set<string>):Set<string>{
 const out=new Set(base);
 for(const id of hits)for(const a of pathTo(root,id).slice(0,-1))out.add(a.id);
 return out;
}

export function layoutMind(root:AtlasNode,expanded:Set<string>):MindLayout{
 const boxes:MindBox[]=[];
 const byId=new Map<string,MindBox>();
 const widths:number[]=[];
 const visible=(n:AtlasNode)=>expanded.has(n.id)?n.children:[];
 // 1) ширины колонок
 const measure=(n:AtlasNode,depth:number)=>{
  widths[depth]=Math.max(widths[depth]??0,sizeOfNode(n,depth).w);
  for(const c of visible(n))measure(c,depth+1);
 };
 measure(root,0);
 const colX:number[]=[0];
 for(let d=1;d<widths.length;d++)colX[d]=colX[d-1]!+widths[d-1]!+COL_GAP;
 // 2) строки: лист занимает следующую строку, родитель — по центру своих детей
 let row=0;
 const place=(n:AtlasNode,depth:number,parent:string|null):number=>{
  const kids=visible(n);
  const {w,h}=sizeOfNode(n,depth);
  let y:number;
  if(!kids.length){y=row*ROW_H;row++;}
  else{
   const ys=kids.map((k,i)=>{if(depth===0&&i>0)row+=GROUP_GAP/ROW_H;return place(k,depth+1,n.id);});
   y=(ys[0]!+ys[ys.length-1]!)/2;
  }
  const box:MindBox={node:n,x:colX[depth]!,y,w,h,depth,parent,hidden:expanded.has(n.id)?0:countBelow(n)};
  boxes.push(box);byId.set(n.id,box);
  return y;
 };
 place(root,0,null);
 // 3) связи: плавные кривые от правого края родителя к левому краю ребёнка
 const links:MindLink[]=[];
 for(const b of boxes){
  if(!b.parent)continue;
  const p=byId.get(b.parent)!;
  const x1=p.x+p.w,y1=p.y,x2=b.x,y2=b.y,mx=(x1+x2)/2;
  const f=(n:number)=>n.toFixed(1);
  links.push({from:p.node.id,to:b.node.id,clan:b.node.clan,depth:b.depth,d:`M${f(x1)} ${f(y1)} C${f(mx)} ${f(y1)} ${f(mx)} ${f(y2)} ${f(x2)} ${f(y2)}`});
 }
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const b of boxes){minX=Math.min(minX,b.x);maxX=Math.max(maxX,b.x+b.w);minY=Math.min(minY,b.y-b.h/2);maxY=Math.max(maxY,b.y+b.h/2);}
 const pad=60;
 return {boxes,links,byId,bounds:{x:minX-pad,y:minY-pad,w:maxX-minX+2*pad,h:maxY-minY+2*pad}};
}

// ───────── слои: «Связи», «Этапы», «Что сломается, если…» ─────────
export interface DepNode{id:string;dependsOn:string[]}
/** Расстояния от ветви до всего, что от неё зависит (в шагах). Источник не входит в результат. */
export function downstreamDepths(nodes:DepNode[],source:string):Map<string,number>{
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
export function degrees(nodes:DepNode[]):Map<string,{up:number;down:number}>{
 const ids=new Set(nodes.map(n=>n.id));
 const result=new Map(nodes.map(n=>[n.id,{up:n.dependsOn.filter(d=>ids.has(d)).length,down:0}]));
 for(const n of nodes)for(const d of n.dependsOn)if(result.has(d))result.get(d)!.down++;
 return result;
}
export type MindMode="structure"|"links"|"stages"|"impact";
