import type {ForestEvent} from "./kitsune-fox-life";
import type {FoxMetric} from "./kitsune-fox-metrics";
import {nextMedal,TIER_LABEL,type MedalItem} from "./kitsune-medals";

/** Недельный «Лесной отчёт»: три события, ближайшая награда и что ещё не подтверждено. Только реальные данные. */
export interface ForestReport{
 from:string;to:string;
 events:{day:string;title:string}[];
 /** Сколько событий за неделю всего (в отчёт попадают три). */
 eventsTotal:number;
 next:{title:string;percent:number;tier:string}|null;
 unconfirmed:{names:string[];total:number};
 plannedBranches:string[];
 confirmed:number;confirmedTotal:number;earned:number;earnedTotal:number;
}
const DAY=86_400_000;
export const dayKey=(t:number)=>new Date(t).toISOString().slice(0,10);

export function buildForestReport(input:{now:number;events:ForestEvent[];metrics:FoxMetric[];medals:MedalItem[];plannedBranches?:string[]}):ForestReport{
 const to=dayKey(input.now),from=dayKey(input.now-6*DAY);
 const inWeek=input.events.filter(e=>e.day>=from&&e.day<=to).sort((a,b)=>b.day.localeCompare(a.day));
 const seen=new Set<string>();
 const unique=inWeek.filter(e=>!seen.has(e.title)&&(seen.add(e.title),true));
 const missing=input.metrics.filter(m=>m.value===null);
 const next=nextMedal(input.medals);
 return {
  from,to,
  events:unique.slice(0,3).map(e=>({day:e.day,title:e.title})),eventsTotal:unique.length,
  next:next?{title:next.title,percent:Math.round(next.progress*100),tier:TIER_LABEL[next.tier]}:null,
  unconfirmed:{names:missing.slice(0,3).map(m=>m.name),total:missing.length},
  plannedBranches:(input.plannedBranches??[]).slice(0,3),
  confirmed:input.metrics.length-missing.length,confirmedTotal:input.metrics.length,
  earned:input.medals.filter(m=>m.earned).length,earnedTotal:input.medals.length,
 };
}
const MONTHS=["янв.","фев.","мар.","апр.","мая","июн.","июл.","авг.","сен.","окт.","ноя.","дек."];
const dayRu=(key:string)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(key);return m?`${Number(m[3])} ${MONTHS[Number(m[2])-1]}`:key;};
export const periodRu=(r:Pick<ForestReport,"from"|"to">)=>`${dayRu(r.from)} — ${dayRu(r.to)}`;
export const escapeXml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
/** Обрезка по длине для строки карточки. */
export const clip=(s:string,max:number)=>s.length>max?s.slice(0,max-1)+"…":s;
/** Переносит текст по словам на строки не длиннее `max` знаков; всё, что не поместилось в `maxLines`, заменяется многоточием. */
export function wrapLines(text:string,max:number,maxLines:number):string[]{
 const words=text.split(/\s+/).filter(Boolean);
 const lines:string[]=[];let line="";
 for(const w of words){
  if(line&&(line+" "+w).length>max){lines.push(line);line=w;}else line=line?line+" "+w:w;
 }
 if(line)lines.push(line);
 if(lines.length<=maxLines)return lines.map(l=>clip(l,max));
 const kept=lines.slice(0,maxLines);
 kept[maxLines-1]=clip(kept[maxLines-1]!+"…",max);
 return kept;
}

export const REPORT_WIDTH=720,REPORT_HEIGHT=440;
/** Карточка отчёта как SVG (без внешних ресурсов), чтобы её можно было показать и сохранить картинкой. */
export function reportSvg(r:ForestReport):string{
 const lines:string[]=[];
 let y=150;
 const text=(s:string,o:{size?:number;weight?:number;fill?:string;x?:number}={})=>{
  lines.push(`<text x="${o.x??40}" y="${y}" font-size="${o.size??18}" font-weight="${o.weight??400}" fill="${o.fill??"#ececf1"}">${escapeXml(s)}</text>`);
 };
 const head=(s:string)=>{y+=14;text(s,{size:13,weight:700,fill:"#d9a441"});y+=26;};
 head("СОБЫТИЯ НЕДЕЛИ");
 if(r.events.length)for(const e of r.events){text("• "+clip(e.title,58),{});y+=26;}
 else{text("За неделю событий в лесном дневнике нет.",{fill:"#b4b4bd"});y+=26;}
 head("БЛИЖАЙШАЯ НАГРАДА");
 if(r.next)text(`${clip(r.next.title,40)} · ${r.next.percent}% · ${r.next.tier}`,{});
 else text("Пока нет награды с измеримым прогрессом.",{fill:"#b4b4bd"});
 y+=26;
 head("ЕЩЁ НЕ ПОДТВЕРЖДЕНО");
 const open=[...r.unconfirmed.names,...r.plannedBranches.map(b=>"ветвь «"+b+"» (план)")];
 if(r.unconfirmed.total||r.plannedBranches.length){
  const rest=r.unconfirmed.total>3?` · и ещё ${r.unconfirmed.total-3}`:"";
  for(const line of wrapLines(open.join(" · ")+rest,52,2)){text(line,{});y+=24;}
 }
 else text("Всё, что есть в дереве, подтверждено.",{fill:"#b4b4bd"});
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${REPORT_WIDTH}" height="${REPORT_HEIGHT}" viewBox="0 0 ${REPORT_WIDTH} ${REPORT_HEIGHT}" font-family="Inter,'Segoe UI',system-ui,sans-serif">`
  +`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d1b17"/><stop offset="1" stop-color="#141417"/></linearGradient></defs>`
  +`<rect width="${REPORT_WIDTH}" height="${REPORT_HEIGHT}" rx="28" fill="url(#g)"/><rect x="1" y="1" width="${REPORT_WIDTH-2}" height="${REPORT_HEIGHT-2}" rx="27" fill="none" stroke="#d9a441" stroke-opacity=".45"/>`
  +`<text x="40" y="62" font-size="30" font-weight="700" fill="#ececf1">🦊 Лесной отчёт</text>`
  +`<text x="40" y="92" font-size="15" fill="#b4b4bd">${escapeXml(periodRu(r))}</text>`
  +`<text x="40" y="124" font-size="16" fill="#ececf1">Показателей подтверждено: <tspan font-weight="700" fill="#d9a441">${r.confirmed} из ${r.confirmedTotal}</tspan> · наград: <tspan font-weight="700" fill="#d9a441">${r.earned} из ${r.earnedTotal}</tspan></text>`
  +lines.join("")
  +`<text x="40" y="${REPORT_HEIGHT-24}" font-size="12" fill="#8a8a94">JUUNIBI · только данные, подтверждённые источниками</text>`
  +`</svg>`;
}
/** Сохраняет карточку PNG-файлом (в браузере). Возвращает false, если браузер не смог нарисовать картинку. */
export async function saveReportPng(r:ForestReport,scale=2):Promise<boolean>{
 try{
  const svg=reportSvg(r);
  const url=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"}));
  try{
   const img=new Image();
   await new Promise<void>((ok,bad)=>{img.onload=()=>ok();img.onerror=()=>bad(new Error("image"));img.src=url;});
   const canvas=document.createElement("canvas");
   canvas.width=REPORT_WIDTH*scale;canvas.height=REPORT_HEIGHT*scale;
   const ctx=canvas.getContext("2d");
   if(!ctx)return false;
   ctx.scale(scale,scale);ctx.drawImage(img,0,0,REPORT_WIDTH,REPORT_HEIGHT);
   const blob=await new Promise<Blob|null>(res=>canvas.toBlob(res,"image/png"));
   if(!blob)return false;
   const link=document.createElement("a");
   link.href=URL.createObjectURL(blob);link.download=`lesnoy-otchet-${r.to}.png`;
   document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(link.href),2000);
   return true;
  }finally{URL.revokeObjectURL(url);}
 }catch{return false;}
}
