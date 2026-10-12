import type {FoxMetric} from "./kitsune-fox-metrics";
import type {FoxHistory,FoxPoint} from "./kitsune-fox-history";
export type ForestEvent={id:string;day:string;kind:"growth"|"warning"|"achievement"|"recovery"|"update";title:string;detail:string;metricId?:string};
export type ForestAward={id:string;emoji:string;title:string;detail:string;earned:boolean};
const ID_PATTERN=/^fox-(?:[0-9]|[1-9][0-9])$/;
export function safeForestEvents(raw:unknown):ForestEvent[]{
 if(!Array.isArray(raw))return [];
 const result:ForestEvent[]=[];
 for(const entry of raw.slice(-150)){
  if(!entry||typeof entry!=="object")continue;
  const e=entry as Partial<ForestEvent>;
  if(typeof e.id!=="string"||e.id.length>160||typeof e.day!=="string"||e.day.length!==10||
    !["growth","warning","achievement","recovery","update"].includes(e.kind??"")||
    typeof e.title!=="string"||typeof e.detail!=="string")continue;
  result.push({id:e.id,day:e.day,kind:e.kind!,title:e.title.slice(0,180),detail:e.detail.slice(0,360),
   metricId:typeof e.metricId==="string"&&ID_PATTERN.test(e.metricId)?e.metricId:undefined});
 }
 return result;
}
export function mergeForestEvents(old:ForestEvent[],incoming:ForestEvent[]):ForestEvent[]{
 const index=new Map(old.map(event=>[event.id,event]));
 for(const event of incoming)index.set(event.id,event);
 return [...index.values()].sort((a,b)=>a.day.localeCompare(b.day)).slice(-150);
}
export function forestAwards(metrics:FoxMetric[],history:FoxHistory):ForestAward[]{
 const get=(id:number)=>metrics[id]?.value??null;
 const count=Object.values(history).filter(x=>x.length>1).length;
 const conditions:[string,string,string,string,boolean][]=[
 ["first","🌱","Первый росток","В лесу появилась подтверждённая ветвь",(get(1)??0)>=1],
 ["roots","🌳","Король корней","В дереве найдено не менее пяти корневых систем",(get(0)??0)>=5],
 ["links","🧵","Паутинка дружбы","Между системами зарегистрировано 20 связей",(get(7)??0)>=20],
 ["steps","🐾","Лисий следопыт","В органайзере завершено десять задач",(get(15)??0)>=10],
 ["release","🚀","Космический хвост","Зарегистрирована успешная установка",(get(40)??0)>=1],
 ["awards","🏅","Лесной чемпион","Система достижений сообщила о пяти наградах",(get(14)??0)>=5],
 ["history","📚","Летописец","Есть история более чем у десяти показателей",count>=10],
 ["brain","🧠","Мудрая лисичка","Завершён хотя бы один план Brain",(get(11)??0)>=1],
 ["healthy","🛡️","Страж леса","Монитор подтвердил отсутствие ошибок",get(12)===0],
 ["forest","🍃","Полный листопад","В архитектуре подтверждено 25 ветвей",(get(1)??0)>=25]
 ];
 return conditions.map(([id,emoji,title,detail,earned])=>({id,emoji,title,detail,earned}));
}
export function forestStory(events:ForestEvent[],metrics:FoxMetric[]):string{
 const real=metrics.filter(m=>m.value!==null).length;
 const latest=events[events.length-1];
 if(!latest)return "🦊 Лес собирает первые воспоминания. Сейчас доступны "+real+" показателей из 100.";
 return "🦊 Последняя запись лесного дневника: "+latest.title+". "+latest.detail+" · Сейчас источники подтвердили "+real+" показателей.";
}
export function sparkPoints(points:FoxPoint[],width=150,height=34):string{
 if(points.length<2)return "";
 const values=points.map(x=>x.value);
 const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
 return points.map((x,i)=>((i/(points.length-1))*(width-4)+2).toFixed(1)+","+((height-4)-((x.value-min)/range)*(height-8)).toFixed(1)).join(" ");
}
export function forestEffects(kind:ForestEvent["kind"]):string{
 return kind==="growth"?"🌱 Выросла новая веточка!":kind==="recovery"?"🌈 Лес снова в порядке!":
 kind==="warning"?"🩹 Лисичка заметила неполадку":kind==="achievement"?"🎉 Золотая шишка!":"✨ Новая глава леса!";
}
