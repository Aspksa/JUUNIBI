import type {FoxMetric} from "./kitsune-fox-metrics";
import type {FoxHistory} from "./kitsune-fox-history";
import {forestAwards} from "./kitsune-fox-life";
import {eliteFoxAwards} from "./kitsune-fox-elite";
import {el,icon} from "../dom";
import {openSheet} from "./sheet";

/** Одна полка для всех наград. Ступень показывает, насколько строги условия награды; это не статистика других людей. */
export type MedalTier="bronze"|"silver"|"gold"|"legend";
export type MedalKind="keeper"|"featured"|"legendary";
export interface MedalItem{
 id:string;emoji:string;title:string;kind:MedalKind;tier:MedalTier;world:string;
 earned:boolean;/** 0..1; без измеримого прогресса — 0, пока награда не получена. */progress:number;
 /** Сложность по порогам награды (см. difficultyScore): чем строже пороги и дольше нужны измерения, тем выше. */difficulty:number;
 /** True when the data needed to judge the award is there. */ready:boolean;requirement:string;
}
export const TIER_LABEL:Record<MedalTier,string>={bronze:"Бронза",silver:"Серебро",gold:"Золото",legend:"Легенда"};
export const KIND_LABEL:Record<MedalKind,string>={featured:"Особые",keeper:"Хранители",legendary:"Легендарные"};

/** Границы ступеней по сложности: до 3 — бронза, до 6 — серебро, до 9 — золото, дальше — легенда. */
export const TIER_STEPS=[3,6,9] as const;
/**
 * Сложность = сумма log2(1 + порог) по всем условиям + 0,5 за каждый день обязательных измерений.
 * Подтвердить значение (порог 1) — 1; «20 связей» — 4,4; награда третьего ранга темы (порог 6 и 3 плюс 4 дня) — около 6,8.
 */
export function difficultyScore(thresholds:number[],days=0):number{
 const sum=thresholds.reduce((total,t)=>total+Math.log2(1+Math.max(0,Number.isFinite(t)?t:0)),0);
 return Math.round((sum+0.5*Math.max(0,days))*100)/100;
}
export function tierOf(score:number):MedalTier{
 return score<TIER_STEPS[0]?"bronze":score<TIER_STEPS[1]?"silver":score<TIER_STEPS[2]?"gold":"legend";
}
export function medalItems(metrics:FoxMetric[],history:FoxHistory):MedalItem[]{
 const out:MedalItem[]=[];
 forestAwards(metrics,history).forEach((a,i)=>{
  const featured=i<10;
  const difficulty=difficultyScore([a.need]);
  out.push({id:a.id,emoji:a.emoji,title:a.title,kind:featured?"featured":"keeper",tier:tierOf(difficulty),difficulty,
   world:featured?"Особые награды":"Хранители показателей",earned:a.earned,progress:a.earned?1:0,ready:a.earned,requirement:a.detail});
 });
 for(const a of eliteFoxAwards(metrics,history))
  {const difficulty=difficultyScore([a.needs.a,a.needs.b],a.needs.days);
   out.push({id:a.id,emoji:a.emoji,title:a.name,kind:"legendary",tier:tierOf(difficulty),difficulty,world:a.world,
    earned:a.earned,progress:a.progress,ready:a.ready,requirement:a.requirement});}
 return out;
}
/** The unearned award that is closest to being earned; null when nothing has measurable progress. */
export function nextMedal(items:MedalItem[]):MedalItem|null{
 const open=items.filter(m=>!m.earned&&m.progress>0).sort((a,b)=>b.progress-a.progress);
 return open[0]??null;
}
export const RING_RADIUS=34;
export const RING_LENGTH=2*Math.PI*RING_RADIUS;
export function ringDash(progress:number):string{
 const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
 return (RING_LENGTH*p).toFixed(1)+" "+RING_LENGTH.toFixed(1);
}
export function medalState(m:MedalItem):"earned"|"progress"|"waiting"|"locked"{
 return m.earned?"earned":m.progress>0?"progress":m.ready?"waiting":"locked";
}
export const STATE_LABEL={earned:"Получена",progress:"В процессе",waiting:"Условие пока не выполнено",locked:"Нет данных для проверки"} as const;

const NS="http://www.w3.org/2000/svg";
const svg=(name:string,attrs:Record<string,string>={},...kids:(SVGElement|string)[])=>{
 const n=document.createElementNS(NS,name);
 for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);
 for(const k of kids)n.append(k);
 return n;
};
/** A round medal with a progress ring. Static: no animation. */
export function medalSvg(m:MedalItem,size=84):SVGSVGElement{
 const state=medalState(m);
 const root=svg("svg",{viewBox:"0 0 80 80",width:String(size),height:String(size),class:`kt-medal tier-${m.tier} is-${state}`,"aria-hidden":"true",focusable:"false"}) as SVGSVGElement;
 root.append(
  svg("circle",{cx:"40",cy:"40",r:String(RING_RADIUS),class:"m-track",fill:"none","stroke-width":"5"}));
 // A ring of zero length would still draw a dot with round caps, so it is only added when there is progress.
 if(m.earned||m.progress>0)root.append(svg("circle",{cx:"40",cy:"40",r:String(RING_RADIUS),class:"m-ring",fill:"none","stroke-width":"5","stroke-linecap":"round",
   "stroke-dasharray":ringDash(m.earned?1:m.progress),transform:"rotate(-90 40 40)"}));
 root.append(
  svg("circle",{cx:"40",cy:"40",r:"27",class:"m-face"}),
  svg("circle",{cx:"40",cy:"40",r:"23",class:"m-inner",fill:"none","stroke-width":"1"}));
 const glyph=svg("text",{x:"40",y:"48",class:"m-glyph","text-anchor":"middle","font-size":"24"});
 glyph.textContent=m.emoji;
 root.append(glyph);
 if(m.earned){
  root.append(svg("circle",{cx:"63",cy:"63",r:"9",class:"m-badge"}),
   svg("path",{d:"M58.5 63.2l3.2 3.1 5-5.8",class:"m-check",fill:"none","stroke-width":"2.2","stroke-linecap":"round","stroke-linejoin":"round"}));
 }
 return root;
}
function medalCard(m:MedalItem):HTMLButtonElement{
 const state=medalState(m);
 const percent=Math.round((m.earned?1:m.progress)*100);
 const card=el("button",{type:"button",cls:`kt-medal-card tier-${m.tier} is-${state}`,
  attrs:{"aria-label":`${m.title}. ${TIER_LABEL[m.tier]}. ${STATE_LABEL[state]}${state==="progress"?", "+percent+"%":""}`}},
  medalSvg(m),
  el("strong",{cls:"mc-title",textContent:m.title}),
  el("span",{cls:"mc-meta",textContent:TIER_LABEL[m.tier]+" · "+(m.earned?"получена":state==="progress"?percent+"%":state==="waiting"?"ещё нет":"нет данных")}));
 card.addEventListener("click",()=>openMedal(m));
 return card;
}
export function openMedal(m:MedalItem){
 const state=medalState(m);
 const percent=Math.round((m.earned?1:m.progress)*100);
 openSheet({title:m.title,icon:"target",sub:TIER_LABEL[m.tier]+" · "+m.world,tone:m.earned?"ok":state==="progress"?"warn":"off",
  content:el("div",{cls:"kt-medal-detail"},
   el("div",{cls:"md-art"},medalSvg(m,120)),
   el("p",{cls:"md-state",textContent:STATE_LABEL[state]+(state==="progress"?" · "+percent+"%":"")}),
   el("p",{textContent:m.requirement}),
   el("p",{cls:"md-difficulty",textContent:"Сложность: "+m.difficulty.toFixed(1).replace(".",",")+" · "+TIER_LABEL[m.tier]}),
   el("small",{cls:"muted",textContent:"Ступень считается по порогам награды: бронза — до "+TIER_STEPS[0]+", серебро — до "+TIER_STEPS[1]+", золото — до "+TIER_STEPS[2]+", дальше — легенда. "
     +(m.kind==="legendary"?"Если источники недоступны, награда остаётся закрытой.":m.kind==="keeper"?"Награда за подтверждённое значение показателя.":"Особая награда за подтверждённое событие в проекте.")}))});
}

export interface ShelfState{view:"all"|"earned"|"progress"|"locked";kind:"all"|MedalKind;limit:number}
export const newShelfState=():ShelfState=>({view:"all",kind:"all",limit:24});
export function filterMedals(items:MedalItem[],s:ShelfState):MedalItem[]{
 return items.filter(m=>{
  if(s.kind!=="all"&&m.kind!==s.kind)return false;
  const st=medalState(m);
  return s.view==="all"?true:s.view==="earned"?st==="earned":s.view==="progress"?st==="progress":st==="waiting"||st==="locked";
 });
}
/** The award shelf: filter chips, a grid of medals, a "show more" button. Keeps its own state. */
export function awardShelf(items:MedalItem[],state:ShelfState):HTMLElement{
 const earned=items.filter(m=>m.earned).length;
 const chips=el("div",{cls:"kt-chips",attrs:{role:"group","aria-label":"Фильтр наград"}});
 const grid=el("div",{cls:"kt-medal-grid"});
 const more=el("button",{type:"button",cls:"kt-more",textContent:"Показать ещё"});
 const count=el("p",{cls:"kt-shelf-count",attrs:{"aria-live":"polite"}});
 const paint=()=>{
  const list=filterMedals(items,state);
  chips.replaceChildren(
   ...(["all","earned","progress","locked"] as const).map(v=>{
    const b=el("button",{type:"button",cls:"kt-chip",textContent:{all:"Все",earned:"Полученные",progress:"В процессе",locked:"Закрытые"}[v],attrs:{"aria-pressed":String(state.view===v)}});
    b.addEventListener("click",()=>{state.view=v;state.limit=24;paint();});return b;}),
   el("span",{cls:"kt-chip-sep",attrs:{"aria-hidden":"true"}}),
   ...(["all","featured","keeper","legendary"] as const).map(k=>{
    const b=el("button",{type:"button",cls:"kt-chip",textContent:k==="all"?"Все виды":KIND_LABEL[k],attrs:{"aria-pressed":String(state.kind===k)}});
    b.addEventListener("click",()=>{state.kind=k;state.limit=24;paint();});return b;}));
  count.textContent="Получено "+earned+" из "+items.length+" · показано "+Math.min(state.limit,list.length)+" из "+list.length;
  grid.replaceChildren(...list.slice(0,state.limit).map(medalCard));
  if(!list.length)grid.append(el("p",{cls:"kt-empty",textContent:"В этой категории наград пока нет."}));
  more.hidden=list.length<=state.limit;
 };
 more.addEventListener("click",()=>{state.limit+=24;paint();});
 paint();
 return el("section",{cls:"kt-shelf",attrs:{"aria-label":"Полка наград"}},chips,count,grid,more);
}
/** A single compact "next award" tile for the Today view. */
export function nextMedalTile(items:MedalItem[]):HTMLElement{
 const next=nextMedal(items);
 if(!next)return el("div",{cls:"kt-today-tile"},icon("target",20),el("div",{},el("strong",{textContent:"Ближайшая награда"}),el("small",{cls:"muted",textContent:"Пока ни у одной награды нет измеримого прогресса."})));
 const b=el("button",{type:"button",cls:"kt-today-tile is-link"},medalSvg(next,56),
  el("div",{},el("strong",{textContent:"Ближайшая награда"}),el("span",{textContent:next.title}),el("small",{cls:"muted",textContent:Math.round(next.progress*100)+"% · "+TIER_LABEL[next.tier]})));
 b.addEventListener("click",()=>openMedal(next));
 return b;
}
