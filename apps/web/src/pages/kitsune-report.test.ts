import {describe,expect,it} from "vitest";
import {REPORT_HEIGHT,REPORT_WIDTH,buildForestReport,clip,dayKey,escapeXml,periodRu,reportSvg,wrapLines} from "./kitsune-report";
import type {ForestEvent} from "./kitsune-fox-life";
import type {FoxMetric} from "./kitsune-fox-metrics";
import type {MedalItem} from "./kitsune-medals";

const NOW=Date.parse("2026-10-12T12:00:00Z");
const ev=(day:string,title:string):ForestEvent=>({id:day+title,day,kind:"update",title,detail:""});
const metric=(i:number,value:number|null):FoxMetric=>({id:"fox-"+i,name:"Показатель "+i,world:0,emoji:"🌳",value,source:"s",description:"d",target:"architecture"});
const medal=(o:Partial<MedalItem>):MedalItem=>({id:"m",emoji:"🦊",title:"Награда",kind:"keeper",tier:"gold",difficulty:7,world:"w",earned:false,progress:0,ready:false,requirement:"r",...o});

describe("недельный отчёт",()=>{
 it("берёт события только за последние 7 дней, без повторов, не больше трёх, свежие первыми",()=>{
  const r=buildForestReport({now:NOW,events:[ev("2026-10-05","старое"),ev("2026-10-06","граница"),ev("2026-10-12","а"),ev("2026-10-11","б"),ev("2026-10-11","б"),ev("2026-10-10","в"),ev("2026-10-09","г")],metrics:[],medals:[]});
  expect(r.from).toBe("2026-10-06");expect(r.to).toBe("2026-10-12");
  expect(r.events.map(e=>e.title)).toEqual(["а","б","в"]);
  expect(r.eventsTotal).toBe(5);
 });
 it("без событий отчёт честно пустой",()=>{
  const r=buildForestReport({now:NOW,events:[],metrics:[],medals:[]});
  expect(r.events).toEqual([]);expect(r.next).toBeNull();
  expect(reportSvg(r)).toContain("За неделю событий в лесном дневнике нет.");
 });
 it("ближайшая награда — с наибольшим прогрессом; неподтверждённое — первые три и счётчик",()=>{
  const r=buildForestReport({now:NOW,events:[],metrics:[metric(0,1),metric(1,null),metric(2,null),metric(3,null),metric(4,null)],
   medals:[medal({title:"А",progress:.2}),medal({title:"Б",progress:.5}),medal({title:"В",earned:true,progress:1})],plannedBranches:["Мозг 3.0"]});
  expect(r.next).toEqual({title:"Б",percent:50,tier:"Золото"});
  expect(r.unconfirmed).toEqual({names:["Показатель 1","Показатель 2","Показатель 3"],total:4});
  expect(r.plannedBranches).toEqual(["Мозг 3.0"]);
  expect(r).toMatchObject({confirmed:1,confirmedTotal:5,earned:1,earnedTotal:3});
 });
 it("картинка: размеры, русский текст, чисел из отчёта достаточно",()=>{
  const r=buildForestReport({now:NOW,events:[ev("2026-10-12","Установлена версия")],metrics:[metric(0,1)],medals:[]});
  const svg=reportSvg(r);
  expect(svg).toContain(`width="${REPORT_WIDTH}" height="${REPORT_HEIGHT}"`);
  expect(svg).toContain("Лесной отчёт");expect(svg).toContain("Установлена версия");expect(svg).toContain("6 окт. — 12 окт.");
  expect(svg).toContain("1 из 1");
  expect(svg.startsWith("<svg")&&svg.endsWith("</svg>")).toBe(true);
 });
 it("текст экранируется: чужие заголовки не могут вставить разметку",()=>{
  const r=buildForestReport({now:NOW,events:[ev("2026-10-12","<script>alert(1)</script> & \"x\"")],metrics:[],medals:[]});
  const svg=reportSvg(r);
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;");expect(svg).toContain("&amp;");
  expect(escapeXml(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
 });
 it("длинные строки обрезаются, даты по-русски",()=>{
  expect(clip("абвгд",5)).toBe("абвгд");expect(clip("абвгде",5)).toBe("абвг…");
  expect(dayKey(NOW)).toBe("2026-10-12");
  expect(periodRu({from:"2026-01-01",to:"2026-01-07"})).toBe("1 янв. — 7 янв.");
 });
 it("длинный список неподтверждённого переносится на строки и не вылезает за картинку",()=>{
  expect(wrapLines("раз два три",20,2)).toEqual(["раз два три"]);
  expect(wrapLines("слово ".repeat(20).trim(),20,2).length).toBe(2);
  expect(wrapLines("слово ".repeat(20).trim(),20,2)[1]!.endsWith("…")).toBe(true);
  expect(wrapLines("",10,2)).toEqual([]);
  expect(wrapLines("а".repeat(80),20,2).every(l=>l.length<=20)).toBe(true);
  const r=buildForestReport({now:NOW,events:[],metrics:Array.from({length:30},(_,i)=>metric(i,null)),medals:[],plannedBranches:["Очень длинное название будущей ветви проекта"]});
  const svg=reportSvg(r);
  for(const m of svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g))expect(m[1]!.length).toBeLessThanOrEqual(80);
 });
});
