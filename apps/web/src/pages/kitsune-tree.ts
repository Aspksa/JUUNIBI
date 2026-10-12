import {getFoxPulls,refreshFoxChecks,foxPullTrack,type FoxPull} from "./kitsune-fox-github";
import {foxBranches,BRANCH_TRACKS,type BranchTrack} from "./kitsune-fox-branches";
import {eliteFoxAwards} from "./kitsune-fox-elite";
import {synchronizeFoxHistory,type FoxHourly} from "./kitsune-fox-server";
import {foxMotion,foxChangedMetrics,foxVerifiedReadings} from "./kitsune-fox-motion";
import {forestAwards,forestStory,sparkPoints,forestEffects,mergeForestEvents,safeForestEvents,type ForestEvent} from "./kitsune-fox-life";
import {readHistory,saveHistory,recordMetrics,metricDelta,forestMood,type FoxHistory} from "./kitsune-fox-history";
import {FOX_WORLDS,foxMetrics,type FoxLive,type FoxMetric} from "./kitsune-fox-metrics";
import {growthEvents,type GrowthEvent} from "./kitsune-growth";
import {downstreamImpact,compareManifests,architectureQuestion} from "./kitsune-impact";
import { traceCapabilities, evolutionChronology, architecturePrompt } from "./kitsune-lineage";
import { validateEvolutionManifest, recommendEvolution, type EvolutionNode, type EvolutionSnapshot } from "./kitsune-evolution-model";
import { el, icon, type IconName } from "../dom";
import { openSheet } from "./sheet";
import { RAIL, RAIL_ITEMS, SEARCHABLE, activeItem, type FoxView, type TreeMode } from "./kitsune-sections";
import { dateRu, shortVersion, withRuTitle } from "./kitsune-ru";
import { buildForestReport, reportSvg, saveReportPng } from "./kitsune-report";
import { buildAtlas, countLeaves, allNodes, type AtlasInput, type AtlasNode } from "./kitsune-atlas-model";
import { mindView, newMindState } from "./kitsune-mindmap";
import { connectGuide } from "./kitsune-connect";
import { timeFrames, canTravel, frameDiff } from "./kitsune-time";
import { awardShelf, medalItems, medalSvg, newShelfState, nextMedalTile, openMedal, RING_RADIUS, ringDash, TIER_LABEL, type MedalItem } from "./kitsune-medals";
import { api } from "../api";
import { evolutionFromUpdater, evolutionStateLabel, type EvolutionRelease } from "./kitsune-updates";

export type { TreeMode };
export interface TreeNode {
 id:string; title:string; description:string; how:string; status:"implemented"|"planned";
 dependsOn:string[]; evidence?:string; stage:number;
}
export const TREE_NODES:TreeNode[]=[
 {id:"core",title:"JUUNIBI Core",description:"Основа приложения и координация модулей.",
 how:"Запускает приложение и соединяет интерфейс с системными службами.",status:"implemented",dependsOn:[],stage:0},
 {id:"brain",title:"Brain Evolution 2.0",description:"Интеллект, работа с опытом и проверочные сценарии.",
 how:"Анализирует план, сопоставляет подтверждённые решения, проверяет риск и готовит рекомендацию.",status:"implemented",dependsOn:["core"],stage:1,evidence:"https://github.com/Aspksa/JUUNIBI/pull/269"},
 {id:"memory",title:"Graph Memory",description:"Долговременная память SQLite и связи решений.",
 how:"Сохраняет подтверждённые исходы, индексирует смысловые векторы и предоставляет графовые связи.",status:"implemented",dependsOn:["brain"],stage:2,evidence:"https://github.com/Aspksa/JUUNIBI/pull/265"},
 {id:"search",title:"Hybrid Search",description:"Совместный лексический и векторный поиск.",
 how:"Объединяет совпадения слов и embeddings; при недоступности провайдера использует лексический поиск.",status:"implemented",dependsOn:["memory"],stage:3,evidence:"https://github.com/Aspksa/JUUNIBI/pull/269"},
 {id:"strategy",title:"Strategy Lab",description:"Безопасное сравнение и калибровка стратегий.",
 how:"Проверяет успехи, неудачи, зависимости и риск; не выполняет действия без разрешения.",status:"implemented",dependsOn:["brain","memory"],stage:3,evidence:"https://github.com/Aspksa/JUUNIBI/pull/268"},
 {id:"benchmark",title:"Brain Benchmark",description:"Детерминированные сценарии контроля качества.",
 how:"Проверяет ранжирование стратегий и показатели поиска на фиксированных примерах.",status:"implemented",dependsOn:["search","strategy"],stage:4,evidence:"https://github.com/Aspksa/JUUNIBI/pull/269"},
 {id:"tasks",title:"Дела и достижения",description:"Планирование задач и отслеживание прогресса.",
 how:"Показывает дела, цели, события и достижения пользователя.",status:"implemented",dependsOn:["core"],stage:1},
 {id:"disk",title:"Диск",description:"Файловое пространство JUUNIBI.",
 how:"Позволяет работать с файлами в интерфейсе приложения.",status:"implemented",dependsOn:["core"],stage:1},
 {id:"agent",title:"Agent",description:"Контролируемые действия помощницы.",
 how:"Перед выполнением чувствительных операций требуется явное подтверждение.",status:"implemented",dependsOn:["brain"],stage:2},
 {id:"evolution3",title:"Brain Evolution 3.0",description:"Полная индексация памяти и независимые проверки обучения.",
 how:"Запланированное расширение; нельзя считать уже реализованной возможностью.",status:"planned",dependsOn:["benchmark","memory"],stage:5}
];
export const treeConnections=()=>TREE_NODES.flatMap(node=>node.dependsOn.map(from=>({from,to:node.id})));
export function kitsuneTreePage():HTMLElement {
 let mode:TreeMode="mindmap",selected="brain",filter="";
 let foxView:FoxView="metrics";
  const mindState=newMindState();
 let frameIndex=-1; // -1 = «сейчас»
 const shelfState=newShelfState();
 let releases:EvolutionRelease[]=[];
 let updateStatusValue:Parameters<typeof evolutionFromUpdater>[0]=null;
 let updateHistoryValue:Parameters<typeof evolutionFromUpdater>[1]=null;
 let dynamicNodes:EvolutionNode[]|null=null;
 let persistedHistory:EvolutionSnapshot["timeline"]|null=null;
 let updatesLoading=true;
 let discovery:EvolutionSnapshot["discovery"]|null=null;
 let brainMessages:{role:"user"|"assistant";text:string}[]=[];
 let brainBusy=false;
 let growth:GrowthEvent[]=[];
 let activeVersion="";
 let playedEvent="";
 let foxWorld=-1;
 let foxOnlyFavorite=false;
 let foxSearch="";
 let foxSnapshot:EvolutionSnapshot|null=null;
 let foxLive:FoxLive={};
 let foxLoading=true;
 let foxReaction="";
 let foxPeriod:1|7|30|90=7;
 let foxHourly:FoxHourly={};
 let foxHistory:FoxHistory=readHistory();
 let foxFavoriteSort=false;
 let foxEvents:ForestEvent[]=[];
 const eventStoreKey="juunibi:fox:events:v1";
 const seenStoreKey="juunibi:fox:seen:v1";
 const foxSeen=new Set<string>();
 try{foxEvents=safeForestEvents(JSON.parse(localStorage.getItem(eventStoreKey)??"[]") as unknown);const raw=JSON.parse(localStorage.getItem(seenStoreKey)??"[]") as unknown;if(Array.isArray(raw))for(const id of raw)if(typeof id==="string")foxSeen.add(id);}catch{/* Storage optional */}
 let foxCompact=false;
 let foxLastAward="";
 let foxKnownNumbers=new Map<string,number>();
 let foxChanged=new Set<string>();
 let foxLimit=24;
 let foxTrack:BranchTrack="update";
 let foxPulls:FoxPull[]|null=null;
 let foxPullsLoading=true;
 const favoritesKey="juunibi:fox-commotion:favorites:v1";
 let foxFavorites=new Set<string>();
 try{const saved=JSON.parse(localStorage.getItem(favoritesKey)??"[]") as unknown;if(Array.isArray(saved))foxFavorites=new Set(saved.filter((x):x is string=>typeof x==="string"&&/^fox-(?:[0-9]|[1-9][0-9])$/.test(x)));}catch{/* Private storage disabled */}
 const body=el("div",{cls:"kt-layout"});
 const status=el("p",{cls:"muted kt-status",attrs:{"aria-live":"polite"}});
 const rail=el("aside",{cls:"kt-rail",attrs:{"aria-label":"Панель Лисьего древа"}});
 const query=el("input",{cls:"kt-search",attrs:{type:"search",placeholder:"Найти ветвь…","aria-label":"Поиск ветви"}});
 query.addEventListener("input",()=>{filter=query.value.toLocaleLowerCase("ru");render();});
 const controls=el("div",{cls:"kt-controls"},query);
 const notice=el("p",{cls:"kt-notice",attrs:{role:"status"}});
 notice.hidden=true;
 const main=el("div",{cls:"kt-main"},controls,status,body);
 const root=el("div",{cls:"page kitsune-tree"},notice,el("div",{cls:"kt-shell"},rail,main));
 const nodesOf=():EvolutionNode[]=>((dynamicNodes??TREE_NODES) as EvolutionNode[]).map(withRuTitle);
 /** Идентификатор ветви манифеста на карте-схеме: ядро — корень, остальные — с приставкой. */
 const mindId=(id:string)=>id==="core"?"root":"m:"+id;
 let lastSection="";
 function render(){
   // A redraw rebuilds the page body; keep the caret where the person was typing.
   const active=document.activeElement;
   const label=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement||active instanceof HTMLSelectElement?active.getAttribute("aria-label"):null;
   const caret=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement?active.selectionStart:null;
   const hadFocus=document.activeElement===query,caretAt=query.selectionStart;
   if(query.parentElement!==controls)controls.prepend(query);
   draw();
   const sectionKey=mode+":"+(mode==="fox"?foxView:"");
   if(sectionKey!==lastSection){
     lastSection=sectionKey;
     body.classList.remove("is-enter");void body.offsetWidth;body.classList.add("is-enter");
   }
   if(mode!=="mindmap"&&mode!=="fox"){
     const head=sectionHead(mode,status.textContent?.trim()??"");
     body.prepend(head);status.textContent="";
     if(SEARCHABLE.has(mode)){
       // поиск живёт в шапке раздела, а не отдельной строкой над ней
       head.append(query);query.hidden=false;controls.hidden=true;
       if(hadFocus){query.focus();if(caretAt!==null)try{query.setSelectionRange(caretAt,caretAt);}catch{/* не поле ввода */}}
     }
   }
   status.hidden=!status.textContent?.trim();
   if(label&&root.contains(active)===false){
     const again=[...root.querySelectorAll<HTMLElement>("input,textarea,select")].find(x=>x.getAttribute("aria-label")===label);
     if(again){again.focus();if(caret!==null&&again instanceof HTMLInputElement)try{again.setSelectionRange(caret,caret);}catch{/* not selectable */}}
   }
 }
 function draw(){
   const metrics=foxMetrics({nodes:nodesOf(),snapshot:foxSnapshot,growth,live:foxLive});
   const medals=medalItems(metrics,foxHistory);
   renderRail(metrics,medals);
   query.hidden=!SEARCHABLE.has(mode);controls.hidden=query.hidden;
   body.classList.toggle("kt-solo",mode==="fox"||mode==="mindmap");
   if(mode==="mindmap"){renderMind(metrics,medals);return;}
   if(mode==="fox"){renderFox();return;}
   if(mode==="growth"){
     const timeline=el("div",{cls:"kt-growth-timeline",attrs:{"aria-label":"Подтверждённые события роста"}});
     if(!growth.length)timeline.append(el("p",{cls:"kt-empty",textContent:"Подтверждённых изменений между двумя сохранёнными манифестами пока нет. Эффекты появятся после установки нового релиза и получения обоих снимков."}));
     for(const item of growth){
       const card=el("article",{cls:"kt-growth-event kt-growth-"+item.kind},
         el("span",{cls:"kt-growth-orb",attrs:{"aria-hidden":"true"}}),
         el("div",{},el("strong",{textContent:item.title}),el("small",{textContent:item.detail})));
       if(item.nodeId&&nodesOf().some(n=>n.id===item.nodeId)){
         const go=el("button",{textContent:"Открыть ветвь →"});
         go.addEventListener("click",()=>{selected=item.nodeId!;mode="mindmap";mindState.mode="impact";mindState.selected=mindId(item.nodeId!);render();});
         card.append(go);
       }
       timeline.append(card);
     }
     const side=el("aside",{cls:"kt-detail"},
       el("span",{cls:"kt-eyebrow",textContent:"РОСТ · ПОДТВЕРЖДЕНО"}),
       el("h2",{textContent:"Рост без иллюзий"}),
       el("p",{textContent:"Визуальные эффекты отображают только изменения между подтверждёнными снимками установленной архитектуры. Кандидаты сканера находятся в отдельном разделе."}),
       el("p",{cls:"kt-state",textContent:"Установленная версия: "+(shortVersion(activeVersion)||"не определена")}));
     body.replaceChildren(timeline,side);
     status.textContent=growth.length+" подтверждённых событий эволюции";return;
   }
   if(mode==="discovery"){
     const panel=el("div",{cls:"kt-graph"});
     const data=discovery;
     if(!data)panel.append(el("p",{textContent:"Данные сканирования недоступны. Обновите локальный сервер JUUNIBI."}));
     else{
       panel.append(el("p",{textContent:"Просканировано файлов: "+data.scanned+" · кандидатов: "+data.candidates.length+" · циклов: "+data.cycles.length+(data.truncated?" · лимит сканирования":"")}));
       for(const item of data.candidates.filter(x=>(x.file+" "+x.id).toLowerCase().includes(filter)).slice(0,100))
         panel.append(el("article",{cls:"kt-node kt-new-growth"},el("strong",{textContent:item.id}),
           el("small",{textContent:item.file}),el("p",{textContent:"Обнаруженный модуль · "+item.imports.length+" локальных связей. Назначение требует проверки."})));
     }
     const side=el("aside",{cls:"kt-detail"},el("h2",{textContent:"Автоматический аудит"}),
       el("p",{textContent:"Сканер только читает код. Обнаруженные файлы — кандидаты, не подтверждённые способности. Древо не изменяет исходники и не запускает найденный код."}));
     if(data){
       side.append(el("h3",{textContent:"Циклические зависимости: "+data.cycles.length}));
       for(const c of data.cycles.slice(0,6))side.append(el("p",{textContent:c.join(" → ")}));
       side.append(el("h3",{textContent:"Ветви без прямого совпадения по файлу: "+data.manifestGaps.length}),
         el("p",{textContent:data.manifestGaps.map(id=>withRuTitle({id,title:id}).title).join(", ")||"Нет"}));
       const prompt=el("button",{textContent:"Подготовить разбор для Мозга"});
       prompt.addEventListener("click",()=>{
         const context="Сделай архитектурный аудит JUUNIBI на основании кандидатов, не считая их реализованными возможностями: "+data.candidates.slice(0,20).map(x=>x.file).join(", ")+". Предложи проверки и связи; не меняй проект.";
         const field=el("textarea",{textContent:context,attrs:{readonly:"true","aria-label":"Анализ новых кандидатов"}});
         prompt.replaceWith(field);
       });side.append(prompt);
     }
     body.replaceChildren(panel,side);
     status.textContent=data?"Найдено "+data.candidates.length+" возможных новых модулей":"Сканер пока недоступен";return;
   }
   if(mode==="comparison"){
     const versions=persistedHistory?.snapshots??[];
     const pane=el("div",{cls:"kt-graph"});
     const side=el("aside",{cls:"kt-detail"},el("h2",{textContent:"Сравнение версий"}),
       el("p",{textContent:"Каждый сохранённый манифест закреплён за кодом установленной версии. Изменения вычисляются только между реальными снимками."}));
     if(versions.length<2){
       pane.append(el("p",{textContent:"Для сравнения нужны минимум две последовательно установленные версии с записанными манифестами. Снимки появятся автоматически при открытии дерева после установки."}));
     }else{
       const controls=el("div",{cls:"kt-tabs"});
       const before=el("select",{attrs:{"aria-label":"Предыдущая версия"}}),after=el("select",{attrs:{"aria-label":"Новая версия"}});
       for(const v of versions){
         before.append(el("option",{attrs:{value:v.version},textContent:shortVersion(v.version)}));
         after.append(el("option",{attrs:{value:v.version},textContent:shortVersion(v.version)}));
       }
       before.value=versions[1]!.version;after.value=versions[0]!.version;
       const result=el("div",{cls:"kt-comparison"});
       const show=()=>{
         const x=versions.find(v=>v.version===before.value),y=versions.find(v=>v.version===after.value);
         result.replaceChildren();
         if(!x||!y)return;
         const d=compareManifests(x.manifest.nodes.map(withRuTitle),y.manifest.nodes.map(withRuTitle));
         for(const [title,arr] of [["Новые ветви",d.added],["Удалённые",d.removed],["Изменённые",d.uncertain],["Без изменений",d.unchanged]] as [string,string[]][]){
           result.append(el("article",{cls:"kt-node"},el("strong",{textContent:title+" · "+arr.length}),
             el("p",{textContent:arr.join(", ")||"Нет"})));
         }
       };
       before.addEventListener("change",show);after.addEventListener("change",show);
       controls.append(before,after);pane.append(controls,result);show();
     }
     body.replaceChildren(pane,side);
     status.textContent=versions.length+" сохранённых версий архитектуры";return;
   }
   if(mode==="brain-chat"){
     const pane=el("div",{cls:"kt-brain-panel"});
     const dialog=el("div",{cls:"kt-brain-messages",attrs:{"aria-live":"polite"}});
     for(const m of brainMessages)dialog.append(el("p",{cls:"kt-brain-"+m.role,textContent:(m.role==="user"?"Вы: ":"Мозг: ")+m.text}));
     const node=nodesOf().find(n=>n.id===selected)??nodesOf()[0]!;
     const question=el("textarea",{cls:"kt-brain-input",attrs:{placeholder:"Вопрос по развитию "+node.title,"aria-label":"Вопрос Мозгу"}});
     const ask=el("button",{textContent:brainBusy?"Анализ выполняется…":"Спросить Мозг",attrs:{type:"button"}});
     ask.disabled=brainBusy;
     ask.addEventListener("click",()=>{
       const text=question.value.trim();if(!text||brainBusy)return;
       const prompt=architectureQuestion(nodesOf(),selected,text);
       brainMessages.push({role:"user",text});brainBusy=true;render();
       void api.chat(prompt).then(r=>{
         brainMessages.push({role:"assistant",text:r.ok?r.value.reply:"Ошибка Мозга: "+r.error.message});
       }).catch(()=>brainMessages.push({role:"assistant",text:"Мозг недоступен"})).finally(()=>{brainBusy=false;render();});
     });
     pane.append(el("p",{textContent:"Контекст ветви: "+node.title}),dialog,question,ask);
     const side=el("aside",{cls:"kt-detail"},el("h2",{textContent:"Диалог с Мозгом"}),
       el("p",{textContent:"Запрос отправляется только по нажатию кнопки. Действия помощницы могут требовать отдельного разрешения; этот экран не выполняет изменения проекта."}));
     const change=el("select",{attrs:{"aria-label":"Ветвь для Мозга"}});
     for(const n of nodesOf()){const opt=el("option",{textContent:n.title,attrs:{value:n.id}});if(n.id===selected)opt.selected=true;change.append(opt);}
     change.addEventListener("change",()=>{selected=change.value;render();});side.append(change);
     body.replaceChildren(pane,side);status.textContent="Диалог с Мозгом по выбранной ветви";return;
   }
   if(mode==="history"||mode==="versions"){
     const history=persistedHistory?.history??[];
     let feed:HTMLElement;
     if(mode==="history"){
       const events=evolutionChronology(history).filter(e=>(e.description+" "+e.version).toLowerCase().includes(filter));
       feed=timeline(events.map(e=>({tone:e.kind==="install"?"ok":e.kind==="rollback"?"warn":"bad",title:e.kind==="install"?"Установка":e.kind==="rollback"?"Откат":"Сбой",meta:(dateRu(e.at)||e.at)+" · "+shortVersion(e.version),text:e.description})),
         {title:"Пока тихо",text:"Установки и откаты появятся здесь после первого обновления через Центр обновлений."});
       status.textContent=events.length+" записей";
     }else{
       const traced=traceCapabilities(nodesOf(),persistedHistory?.activeVersion??"",history).filter(i=>i.title.toLowerCase().includes(filter));
       feed=timeline(traced.map(i=>({tone:i.installation==="current"?"ok":i.installation==="recorded"?"info":"muted",title:i.title,
         meta:i.origin?"Изменение #"+i.origin.pr+" · "+i.origin.sha.slice(0,7):"Точный код версии неизвестен",
         text:i.installation==="current"?"Совпадает с установленной версией":i.installation==="recorded"?"Версия есть в журнале":"Наличие способности в установленной версии не подтверждено",
         ...(i.origin?{link:{href:"https://github.com/Aspksa/JUUNIBI/pull/"+i.origin.pr,label:"Исходное изменение ↗"}}:{})})),
         {title:"Нет подтверждённых записей",text:"Происхождение появится, когда будут сохранены снимки архитектуры."});
       status.textContent=traced.length+" возможностей";
     }
     body.replaceChildren(feed,el("aside",{cls:"kt-detail"},el("h2",{textContent:mode==="history"?"Хронология обновлений":"Происхождение возможностей"}),
       el("p",{textContent:"Данные подтверждаются журналом Центра обновлений и точным кодом версии. Совпадение названия не означает подтверждённую установку."})));
     return;
   }
   if(mode==="updates"){
     status.textContent=updatesLoading?"Загружаю историю…":releases.length+" "+(releases.length===1?"версия":"версий");
     const filtered=releases.filter(x=>(x.title+" "+x.description+" "+x.version).toLocaleLowerCase("ru").includes(filter));
     const tone=(s:EvolutionRelease["state"]):TimelineItem["tone"]=>s==="installed"?"ok":s==="failed"?"bad":s==="rolled-back"?"muted":s==="available"?"info":"warn";
     const feed=updatesLoading&&!releases.length?el("p",{cls:"muted",textContent:"Загрузка…"}):timeline(filtered.map(r=>({
       tone:tone(r.state),title:r.title,meta:evolutionStateLabel[r.state]+" · "+shortVersion(r.version),
       text:r.description+"\n"+branchLine(r),...(r.evidence?{link:{href:r.evidence,label:"Изменение в GitHub ↗"}}:{})})),
       {title:"Установок пока нет",text:"Откройте Центр обновлений: проверка версии и история появятся здесь."});
     const side=el("aside",{cls:"kt-detail"},el("h2",{textContent:"Центр обновлений"}),
       persistedHistory?el("p",{cls:"muted",textContent:"Журнал: "+persistedHistory.history.length+" событий · активная версия "+shortVersion(persistedHistory.activeVersion)}):null,
       el("p",{textContent:"Скачивание само по себе не активирует ветку. Статус «Установлено» появляется только после записи об установке; откат сохраняется в истории."}),
       el("a",{cls:"kt-chip is-strong",textContent:"Открыть Центр обновлений →",attrs:{href:"#update"}}));
     body.replaceChildren(feed,side);return;
   }
   const allNodes=nodesOf();
   if(mode==="architect"){
     const advice=recommendEvolution({schemaVersion:1,project:"JUUNIBI",nodes:allNodes});
     const adviceHost=el("div",{cls:"kt-graph"});
     adviceHost.append(el("p",{cls:"muted",textContent:"Правила зависимостей, не генеративный ИИ. Предложения не изменяют проект автоматически."}));
     for(const row of advice){
       const node=allNodes.find(n=>n.id===row.nodeId)!;
       const prompt=architecturePrompt(node,allNodes);
       const button=el("button",{textContent:"Подготовить запрос для Мозга",attrs:{type:"button"}});
       button.addEventListener("click",()=>{
         const panel=el("textarea",{attrs:{readonly:"true","aria-label":"Запрос для разбора Мозгом"},textContent:prompt});
         const copy=el("button",{textContent:"Скопировать"});
         copy.addEventListener("click",()=>{void navigator.clipboard?.writeText(prompt).then(()=>{copy.textContent="Скопировано";});});
         button.replaceWith(panel,copy);
       });
       adviceHost.append(el("article",{cls:"kt-node"},el("strong",{textContent:row.title}),
         el("p",{textContent:row.explanation}),el("small",{textContent:row.ready?"Зависимости готовы":"Есть блокирующие зависимости"}),button));
     }
     body.replaceChildren(adviceHost,el("aside",{cls:"kt-detail"},el("h2",{textContent:"Архитектор развития"}),el("p",{textContent:"Анализирует реальные связи манифеста, показывает блокировки и будущие этапы. Для фактической реализации потребуется отдельное подтверждение."})));
     status.textContent=advice.length+" направлений для развития";return;
   }
 }
 /** Сведения о ветви — окном по центру; связанные ветви открываются в том же окне. */
 /** Версии пересчитываются, когда пришёл любой из двух источников: журнал обновлений или снимки архитектуры. */
 const refreshReleases=()=>{releases=evolutionFromUpdater(updateStatusValue,updateHistoryValue,persistedHistory?.snapshots);};
 const branchLine=(r:EvolutionRelease):string=>{
   const names=r.relatedBranches.map(id=>nodesOf().find(n=>n.id===id)?.title??id).join(", ");
   if(r.branchSource==="snapshots")return names?"Ветви, изменённые по снимкам архитектуры: "+names:"По снимкам архитектуры ветви не менялись";
   if(r.branchSource==="description")return "Предположительно по описанию: "+names;
   return "Ветви не определены: нет снимков архитектуры и пояснения";
 };
 function openNode(id:string){
   const all=nodesOf();
   const node=all.find(n=>n.id===id);
   if(!node)return;
   selected=id;
   const parents=node.dependsOn.map(p=>all.find(n=>n.id===p)).filter((n):n is typeof node=>Boolean(n));
   const kids=all.filter(n=>n.dependsOn.includes(id));
   const jump=(n:typeof node)=>{const b=el("button",{type:"button",cls:"kt-chip",textContent:n.title});b.addEventListener("click",()=>{openNode(n.id);render();});return b;};
   const block=(title:string,...kidsNodes:(Node|string)[])=>el("div",{cls:"kt-sheet-block"},el("h4",{textContent:title}),...kidsNodes);
   const impact=el("button",{type:"button",cls:"kt-chip is-strong",textContent:"Что сломается, если…"});
   const ask=el("button",{type:"button",cls:"kt-chip",textContent:"Спросить Мозг"});
   const content=el("div",{cls:"kt-node-sheet"},
     el("p",{textContent:node.description}),
     block("Как работает",el("p",{textContent:node.how})),
     block("Зависит от",parents.length?el("div",{cls:"kt-chip-row"},...parents.map(jump)):el("p",{cls:"muted",textContent:"Корневой компонент"})),
     block("Связанные ветви",kids.length?el("div",{cls:"kt-chip-row"},...kids.map(jump)):el("p",{cls:"muted",textContent:"Пока нет"})),
     el("p",{cls:"kt-state",textContent:node.status==="implemented"?"Подтверждено в проекте":"План развития, пока не реализовано"}),
     node.evidence?el("a",{textContent:"Открыть подтверждающее изменение ↗",attrs:{href:node.evidence,target:"_blank",rel:"noopener noreferrer"}}):null,
     el("div",{cls:"kt-chip-row"},impact,ask));
   const sheet=openSheet({title:node.title,icon:"link",sub:node.status==="implemented"?"Подтверждено":"Запланировано",tone:node.status==="implemented"?"ok":"off",content});
   impact.addEventListener("click",()=>{sheet.close();mode="mindmap";mindState.mode="impact";mindState.selected=mindId(id);selected=id;render();});
   ask.addEventListener("click",()=>{sheet.close();mode="brain-chat";selected=id;render();});
 }
 /** Куст короны: десять показателей одного мира карточками в окне. */
 function openWorld(index:number){
   const world=FOX_WORLDS[index];
   if(!world)return;
   const metrics=foxMetrics({nodes:nodesOf(),snapshot:foxSnapshot,growth,live:foxLive}).filter(m=>m.world===index);
   const confirmed=metrics.filter(m=>m.value!==null).length;
   const grid=el("div",{cls:"kt-fox-grid kt-world-grid"});
   const sheetRef:{close?:()=>void}={};
   const paint=()=>grid.replaceChildren(...metrics.map(m=>foxCard(m,paint,()=>sheetRef.close?.())));
   paint();
   const sheet=openSheet({title:world.title,icon:"spark",sub:`Подтверждено ${confirmed} из ${metrics.length}`,tone:confirmed===0?"off":confirmed===metrics.length?"ok":"warn",content:grid});
   sheetRef.close=()=>sheet.close();
 }
 /** Разбор показателей Мозгом — только по нажатию, без действий над проектом. */
 function openBrainReport(metrics:FoxMetric[]){
   const report=el("p",{cls:"kt-brain-report",attrs:{"aria-live":"polite"},textContent:"Мозг анализирует подтверждённые данные…"});
   const facts=metrics.filter(m=>m.value!==null).slice(0,40).map(m=>m.name+": "+m.value+" ("+m.source+")").join("; ");
   const prompt="Проанализируй только следующие наблюдаемые показатели JUUNIBI. Укажи проблемы, сильные стороны и три безопасные рекомендации. Не выдумывай отсутствующие значения, не выполняй никаких действий и не меняй проект. Наблюдения: "+facts;
   openSheet({title:"Разбор показателей",icon:"brain",sub:"Мозг смотрит только на подтверждённые значения",tone:"ok",content:el("div",{cls:"kt-node-sheet"},report)});
   void api.chat(prompt).then(r=>{report.textContent=r.ok?r.value.reply:"Мозг недоступен: "+r.error.message;}).catch(()=>{report.textContent="Не удалось связаться с Мозгом";});
 }
 /** Недельный отчёт: карточка с тремя событиями, ближайшей наградой и тем, что ещё не подтверждено. */
 function openReport(metrics:FoxMetric[],medals:MedalItem[]){
   const report=buildForestReport({now:Date.now(),events:foxEvents,metrics,medals,plannedBranches:nodesOf().filter(n=>n.status==="planned").map(n=>n.title)});
   const img=el("img",{cls:"kt-report-img",attrs:{alt:"Лесной отчёт за неделю",src:"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(reportSvg(report))}});
   const save=el("button",{type:"button",cls:"kt-chip is-strong",textContent:"Сохранить картинкой"});
   const note=el("small",{cls:"muted",attrs:{"aria-live":"polite"},textContent:"Картинка сохранится в папку загрузок."});
   save.addEventListener("click",()=>{
     save.disabled=true;note.textContent="Готовим картинку…";
     void saveReportPng(report).then(ok=>{note.textContent=ok?"Готово: файл в папке загрузок.":"Браузер не смог нарисовать картинку. Можно сделать снимок экрана.";}).finally(()=>{save.disabled=false;});
   });
   openSheet({title:"Лесной отчёт",icon:"book",sub:"За последние 7 дней",tone:"ok",content:el("div",{cls:"kt-report"},img,el("div",{cls:"kt-chip-row"},save),note)});
 }
 function helpSheet(){
   openSheet({title:"Как читать Лисье древо",icon:"help",tone:"ok",content:el("div",{cls:"kt-node-sheet"},
     el("p",{textContent:"Ствол и ветви — модули проекта. Заполненный лист подтверждён, пунктирный — запланирован. Крона — 100 показателей в 10 мирах; куст показывает, сколько из десяти подтверждено."}),
     el("p",{textContent:"Каждый показатель знает свой источник. Число 0 — подтверждённое отсутствие событий. «Нет данных» — нужный источник пока не подключён. Избранное хранится только в этом браузере."}),
     el("p",{textContent:"Карта основана на известных компонентах и подтверждённых изменениях. Установленные версии берутся из Центра обновлений; связи новых версий с ветвями определяются по описанию и поэтому предположительны."}),
     el("p",{textContent:"Горячие клавиши: цифры 1–9 переключают разделы слева, «/» — поиск. Колесо мыши на карте — масштаб, перетаскивание — сдвиг, справа внизу — мини-карта."}),
     el("p",{cls:"muted",textContent:"Ничего здесь не меняет проект и не выполняет действий."}))});
 }
 function miniRing(ratio:number,label:string):SVGSVGElement{
   const ns="http://www.w3.org/2000/svg";
   const svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 80 80");svg.setAttribute("class","kt-ring");svg.setAttribute("aria-hidden","true");
   const track=document.createElementNS(ns,"circle");track.setAttribute("cx","40");track.setAttribute("cy","40");track.setAttribute("r",String(RING_RADIUS));track.setAttribute("class","r-track");track.setAttribute("fill","none");track.setAttribute("stroke-width","7");
   const arc=document.createElementNS(ns,"circle");arc.setAttribute("cx","40");arc.setAttribute("cy","40");arc.setAttribute("r",String(RING_RADIUS));arc.setAttribute("class","r-arc");arc.setAttribute("fill","none");arc.setAttribute("stroke-width","7");arc.setAttribute("stroke-linecap","round");arc.setAttribute("stroke-dasharray",ringDash(ratio));arc.setAttribute("transform","rotate(-90 40 40)");
   const t=document.createElementNS(ns,"text");t.setAttribute("x","40");t.setAttribute("y","47");t.setAttribute("text-anchor","middle");t.setAttribute("class","r-text");t.textContent=label;
   svg.append(track);if(ratio>0)svg.append(arc);svg.append(t);return svg;
 }
 /** Левая панель: «Сегодня» и все разделы одним списком. */
 function renderRail(metrics:FoxMetric[],medals:MedalItem[]){
   const availability=metrics.filter(x=>x.value!==null).length;
   const mood=forestMood(metrics);
   const unread=foxEvents.filter(e=>!foxSeen.has(e.id));
   const help=el("button",{type:"button",cls:"kt-help",attrs:{"aria-label":"Как читать Лисье древо",title:"Как читать Лисье древо"}},icon("help",16));
   help.addEventListener("click",helpSheet);
   const acknowledge=el("button",{type:"button",cls:"kt-chip kt-mini",textContent:"Прочитано"});
   acknowledge.disabled=unread.length===0;
   acknowledge.addEventListener("click",()=>{
     for(const event of foxEvents)foxSeen.add(event.id);
     try{localStorage.setItem(seenStoreKey,JSON.stringify([...foxSeen].slice(-150)));}catch{/* Storage optional */}
     render();
   });
   const recent=foxEvents.slice(-3).reverse();
   const reportBtn=el("button",{type:"button",cls:"kt-chip kt-mini",textContent:"🗒 Лесной отчёт"});
   reportBtn.addEventListener("click",()=>openReport(metrics,medals));
   const brain=el("button",{type:"button",cls:"kt-chip kt-mini",textContent:"🧠 Разобрать показатели"});
   brain.addEventListener("click",()=>openBrainReport(metrics));
   const diary=el("details",{cls:"kt-diary"},
     el("summary",{},icon("bell",16),el("span",{textContent:"Дневник леса"}),unread.length?el("b",{cls:"kt-dot",textContent:String(unread.length)}):null),
     el("div",{cls:"kt-diary-body"},
       el("small",{cls:"muted",textContent:unread.length?unread.slice(-1).map(e=>e.title).join(""):"лесной дневник спокоен"}),
       acknowledge,
       foxReaction?el("p",{cls:"kt-fox-reaction",attrs:{"aria-live":"polite"},textContent:foxReaction}):null,
       recent.length?el("ul",{cls:"kt-mini-list"},...recent.map(e=>el("li",{},el("strong",{textContent:forestEffects(e.kind)+" "+e.title}),el("small",{cls:"muted",textContent:e.day})))):el("p",{cls:"muted kt-today-story",textContent:forestStory(foxEvents,metrics)}),
       el("div",{cls:"kt-chip-row"},reportBtn,brain)));
   const today=el("section",{cls:"kt-today",attrs:{"aria-label":"Сегодня"}},
     el("div",{cls:"kt-rail-title"},el("h2",{textContent:"Сегодня"}),help),
     foxCompanion(mood),
     diary);
   const current=activeItem(mode,foxView);
   const badge=(id:string)=>id==="awards"?String(medals.filter(m=>m.earned).length):id==="metrics"?String(availability):"";
   const nav=el("nav",{cls:"kt-rail-nav",attrs:{"aria-label":"Разделы дерева"}},...RAIL.map(group=>el("div",{cls:"kt-rail-group"},
     el("h3",{textContent:group.label}),
     ...group.items.map(item=>{
       const on=current?.id===item.id;
       const count=badge(item.id);
       const b=el("button",{type:"button",cls:"kt-rail-item"+(on?" is-active":""),attrs:on?{"aria-current":"page",title:item.hint}:{title:item.hint}},
         el("span",{cls:"ri-ico",attrs:{"aria-hidden":"true"}},icon(RAIL_ICON[item.id]??"spark",18)),
         el("span",{cls:"ri-text"},el("strong",{textContent:item.label})),
         count?el("span",{cls:"ri-count",textContent:count}):null,
         RAIL_ITEMS.indexOf(item)<9?el("kbd",{cls:"ri-key",attrs:{"aria-hidden":"true"},textContent:String(RAIL_ITEMS.indexOf(item)+1)}):null);
       b.addEventListener("click",()=>openSection(item));
       return b;
     }))));
   rail.replaceChildren(today,nav);
 }
 /** Обзор леса: главная цифра, три факта и ближайшая награда — над картой, а не в боковой панели. */
 function overviewStrip(metrics:FoxMetric[],medals:MedalItem[]):HTMLElement{
   const availability=metrics.filter(x=>x.value!==null).length;
   const earned=medals.filter(m=>m.earned).length;
   const all=nodesOf();
   const planned=all.filter(n=>n.status==="planned").length;
   const last=evolutionChronology(persistedHistory?.history??[])[0];
   const stat=(name:IconName,value:string,label:string)=>el("div",{cls:"kt-stat"},
     el("span",{cls:"kt-stat-ico",attrs:{"aria-hidden":"true"}},icon(name,18)),el("strong",{textContent:value}),el("small",{textContent:label}));
   return el("section",{cls:"kt-overview-strip",attrs:{"aria-label":"Обзор леса"}},
     el("div",{cls:"kt-ov-ring"},miniRing(availability/100,String(availability)),
       el("div",{},el("strong",{textContent:availability+" из 100"}),el("small",{cls:"muted",textContent:foxLoading?"получаем данные…":"показателей подтверждено"}))),
     el("div",{cls:"kt-stats"},
       stat("trophy",earned+" / "+medals.length,"наград"),
       stat("modules",String(all.length-planned)+(planned?" + "+planned:""),planned?"ветвей + план":"ветвей"),
       stat("clock",last?(dateRu(last.at)||"—"):"нет",last?"обновление":"обновлений")),
     nextMedalTile(medals));
 }
 function openSection(item:(typeof RAIL_ITEMS)[number]){
   mode=item.mode;if(item.foxView)foxView=item.foxView;
   render();
   main.scrollIntoView({block:"start",behavior:"auto"});
 }
 /** Горячие клавиши: 1–9 — разделы панели, «/» — поиск. Не мешают набору текста и открытым окнам. */
 const hotkeys=(ev:KeyboardEvent)=>{
   if(!root.isConnected){document.removeEventListener("keydown",hotkeys);return;}
   if(ev.ctrlKey||ev.metaKey||ev.altKey)return;
   const target=ev.target;
   if(target instanceof HTMLElement&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))return;
   const sheetOpen=[...document.querySelectorAll<HTMLElement>(".sheet")].some(s=>s.getBoundingClientRect().width>0);
   if(sheetOpen)return;
   if(ev.key==="/"){
     const field=[...root.querySelectorAll<HTMLInputElement>("input[type=search]")].find(f=>!f.closest("[hidden]")&&f.getBoundingClientRect().width>0);
     if(field){ev.preventDefault();field.focus();}
     return;
   }
   if(/^[1-9]$/.test(ev.key)){
     const item=RAIL_ITEMS[Number(ev.key)-1];
     if(item){ev.preventDefault();openSection(item);}
   }
 };
 document.addEventListener("keydown",hotkeys);
 interface TimelineItem{tone:"ok"|"warn"|"bad"|"info"|"muted";title:string;meta:string;text?:string;link?:{href:string;label:string}}
 /** Лента: вертикальная линия времени, цветные точки, у каждой записи заголовок, дата и пояснение. */
 function timeline(items:TimelineItem[],empty:{title:string;text:string}):HTMLElement{
   if(!items.length)return emptyState(empty.title,empty.text);
   return el("ol",{cls:"kt-tl"},...items.map(i=>el("li",{cls:"kt-tl-item tone-"+i.tone},
     el("span",{cls:"kt-tl-dot",attrs:{"aria-hidden":"true"}}),
     el("div",{cls:"kt-tl-card"},
       el("div",{cls:"kt-tl-top"},el("strong",{textContent:i.title}),el("small",{cls:"muted",textContent:i.meta})),
       i.text?el("p",{textContent:i.text}):null,
       i.link?el("a",{textContent:i.link.label,attrs:{href:i.link.href,target:i.link.href.startsWith("#")?"_self":"_blank",rel:"noopener noreferrer"}}):null))));
 }
 function emptyState(title:string,text:string):HTMLElement{
   return el("div",{cls:"kt-empty-state"},el("span",{cls:"kt-empty-fox",attrs:{"aria-hidden":"true"},textContent:"🦊"}),el("strong",{textContent:title}),el("p",{textContent:text}));
 }
 /** Общая шапка раздела: значок, название, пояснение и счётчик. */
 function sectionHead(mode:TreeMode,count:string):HTMLElement{
   const item=activeItem(mode,foxView);
   return el("header",{cls:"kt-sec-head"},
     el("span",{cls:"kt-sec-ico",attrs:{"aria-hidden":"true"}},icon(item?RAIL_ICON[item.id]??"spark":"spark",22)),
     el("div",{cls:"kt-sec-text"},el("h2",{textContent:item?.label??"Лисье древо"}),el("p",{textContent:item?.hint??""})),
     count?el("span",{cls:"km-count",textContent:count}):null);
 }
 const RAIL_ICON:Record<string,IconName>={mindmap:"modules",metrics:"pulse",awards:"trophy",branches:"flame",updates:"download",history:"clock",versions:"archive",comparison:"rows",growth:"spark",discovery:"search",architect:"wand","brain-chat":"brain"};
 function foxCompanion(mood:{emoji:string;label:string;detail:string}){
   const state=mood.label.includes("помощи")?"warning":mood.label.includes("трудятся")?"working":mood.label.includes("ждёт")?"sleeping":"calm";
   return el("div",{cls:"kt-companion state-"+state,attrs:{role:"status","aria-label":"Настроение лисички: "+mood.label}},
     el("span",{cls:"kc-face",textContent:"🦊",attrs:{"aria-hidden":"true"}}),
     el("div",{},el("strong",{textContent:mood.label}),el("small",{textContent:mood.detail})));
 }
 /** Ползунок времени: дерево таким, каким оно было при установке версии. Только сохранённые снимки. */
 function timeControl(frames:ReturnType<typeof timeFrames>,index:number):HTMLElement{
   const wrap=el("section",{cls:"kt-time",attrs:{"aria-label":"Ползунок времени"}});
   wrap.append(el("div",{cls:"kt-time-head"},el("h3",{textContent:"Ползунок времени"}),
     el("span",{cls:"muted",textContent:canTravel(frames)?"Потяните назад — дерево станет таким, каким было":"Данных нет"})));
   if(!canTravel(frames)){
     wrap.append(el("p",{cls:"muted kt-time-empty",textContent:"Данных нет: снимки архитектуры сохраняются при установке версий и появятся после двух установок. Мы не рисуем прошлое, которого не записали."}));
     return wrap;
   }
   const slider=el("input",{type:"range",attrs:{min:"0",max:String(frames.length-1),step:"1","aria-label":"Версия дерева по времени","aria-valuetext":frames[index]!.label+" · "+frames[index]!.detail}});
   slider.value=String(index);
   slider.addEventListener("input",()=>{const v=Number(slider.value);frameIndex=v>=frames.length-1?-1:v;render();});
   const ticks=el("div",{cls:"kt-time-ticks"},...frames.map((f,i)=>{
     const b=el("button",{type:"button",cls:"kt-tick"+(i===index?" is-on":""),attrs:{"aria-pressed":String(i===index)}},el("strong",{textContent:f.label}),el("small",{textContent:f.detail}));
     b.addEventListener("click",()=>{frameIndex=i>=frames.length-1?-1:i;render();});return b;}));
   wrap.append(slider,ticks);
   if(index<frames.length-1){
     const diff=frameDiff(frames[index]!,frames[frames.length-1]!);
     const titleOf=(id:string)=>[...frames[index]!.nodes,...frames[frames.length-1]!.nodes].find(n=>n.id===id)?.title??id;
     wrap.append(el("p",{cls:"kt-time-note",textContent:`Дерево на момент «${frames[index]!.label}»: ветвей ${frames[index]!.nodes.length} (сейчас ${frames[frames.length-1]!.nodes.length}).`
       +(diff.added.length?` С тех пор появилось: ${diff.added.map(id=>ruTitleOf(titleOf(id),id)).join(", ")}.`:"")+(diff.removed.length?` Исчезло: ${diff.removed.map(id=>ruTitleOf(titleOf(id),id)).join(", ")}.`:"")+" Показатели и награды — на сегодня."}));
   }
   return wrap;
 }
 const ruTitleOf=(title:string,id:string)=>withRuTitle({id,title}).title;
 /** Атлас: большое дерево-плакат из реальных источников. Клик по любому кружку открывает окно по центру. */
 function atlasInput(metrics:FoxMetric[],medals:MedalItem[]):AtlasInput{
   const worldOf=(medal:MedalItem):string=>{
     if(medal.kind==="legendary")return medal.world;
     if(medal.kind==="featured")return "Особые награды";
     const index=Number(/fox-(\d+)$/.exec(medal.id)?.[1]);
     const w=FOX_WORLDS[metrics[index]?.world??-1];
     return "Хранители: "+(w?.title??"прочее");
   };
   const input:AtlasInput={
     nodes:nodesOf(),
     metrics:metrics.map(m=>({id:m.id,name:m.name,world:m.world,emoji:m.emoji,value:m.value})),
     worlds:FOX_WORLDS.map(w=>({emoji:w.emoji,title:w.title})),
     medals:medals.map(m=>({id:m.id,title:m.title,emoji:m.emoji,group:worldOf(m),earned:m.earned,progress:m.progress})),
     ...(discovery?{code:discovery.modules.filter(m=>!/\.(test|spec)\./.test(m.file)).map(m=>({id:m.id,file:m.file}))}:{}),
     ...(foxLive.modules?{modules:foxLive.modules.map(m=>({name:m.name,...(m.title?{title:m.title}:{}),status:m.status}))}:{}),
     ...(persistedHistory?{history:persistedHistory.history.slice(0,16).map(h=>({id:h.id,kind:h.kind,to:h.to,at:h.at,label:(dateRu(h.at)||"—")+" · "+(h.kind==="install"?"установка":h.kind==="rollback"?"откат":"сбой")}))}:{}),
   };
   return input;
 }
 function renderMind(metrics:FoxMetric[],medals:MedalItem[]){
   const frames=timeFrames(persistedHistory,nodesOf());
   const index=frameIndex<0||frameIndex>=frames.length?frames.length-1:frameIndex;
   const shown=frames[index]!.nodes.map(withRuTitle);
   const input={...atlasInput(metrics,medals),nodes:shown};
   const tree=buildAtlas(input);
   const deps:Record<string,string[]>={};
   const stages:Record<string,number>={};
   for(const n of shown){deps[mindId(n.id)]=n.dependsOn.map(mindId);stages[mindId(n.id)]=n.stage;}
   const open=(n:AtlasNode)=>openAtlasNode(n,metrics,medals);
   const earned=medals.filter(m=>m.earned).sort((a,b)=>["bronze","silver","gold","legend"].indexOf(b.tier)-["bronze","silver","gold","legend"].indexOf(a.tier));
   const more=el("button",{type:"button",cls:"kt-chip",textContent:earned.length>12?`Ещё ${earned.length-12} · вся полка`:"Вся полка наград"});
   more.addEventListener("click",()=>{mode="fox";foxView="awards";render();});
   const fruits=el("section",{cls:"kt-fruits",attrs:{"aria-label":"Плоды: награды"}},
     el("h3",{textContent:`Плоды · получено ${earned.length} из ${medals.length}`}),
     earned.length?el("div",{cls:"kt-fruit-row"},...earned.slice(0,12).map(m=>{
       const b=el("button",{type:"button",cls:"kt-fruit",attrs:{title:m.title+" · "+TIER_LABEL[m.tier],"aria-label":m.title+", "+TIER_LABEL[m.tier]}},medalSvg(m,60));
       b.addEventListener("click",()=>openMedal(m));return b;})):el("p",{cls:"muted",textContent:"Полученных наград пока нет: они откроются, когда появятся подтверждённые данные."}),
     more);
   body.replaceChildren(el("div",{cls:"kt-map"},
     el("header",{cls:"kt-map-head km-head"},el("h2",{textContent:"Карта проекта"}),el("span",{cls:"km-count",textContent:countLeaves(tree)+" узлов"})),
     overviewStrip(metrics,medals),
     mindView({tree,state:mindState,onOpen:open,deps,stages}),
     el("div",{cls:"km-below"},timeControl(frames,index),fruits)));
   status.textContent="";
 }
 function infoSheet(title:string,sub:string,lines:string[],actions:[string,()=>void][]=[],tone:"ok"|"warn"|"off"|"bad"="ok"){
   const rows=el("div",{cls:"kt-node-sheet"},...lines.map(l=>el("p",{textContent:l})),
     actions.length?el("div",{cls:"kt-chip-row"},...actions.map(([label,run])=>{const b=el("button",{type:"button",cls:"kt-chip is-strong",textContent:label});b.addEventListener("click",()=>{run();});return b;})):null);
   return openSheet({title,icon:"link",sub,tone,content:rows});
 }
 function openAtlasNode(n:AtlasNode,metrics:FoxMetric[],medals:MedalItem[]){
   const go=(fn:()=>void)=>()=>{fn();render();};
   switch(n.ref.type){
     case "root":case "manifest":openNode(n.ref.key);render();return;
     case "world":openWorld(Number(n.ref.key));return;
     case "metric":{
       const m=metrics.find(x=>x.id===n.ref.key);
       if(!m)return;
       const grid=el("div",{cls:"kt-fox-grid kt-world-grid"});
       const ref:{close?:()=>void}={};
       const paint=()=>grid.replaceChildren(foxCard(m,paint,()=>ref.close?.()));
       paint();
       const sheet=openSheet({title:m.name,icon:"spark",sub:FOX_WORLDS[m.world]?.title??"",tone:m.value===null?"off":"ok",content:grid});
       ref.close=()=>sheet.close();return;
     }
     case "medal":{const item=medals.find(x=>x.id===n.ref.key);if(item)openMedal(item);return;}
     case "medalGroup":{
       const ids=new Set(allNodes(n).filter(x=>x.kind==="leaf").map(x=>x.ref.key));
       const list=medals.filter(m=>ids.has(m.id));
       openSheet({title:n.label,icon:"target",sub:n.note??"",tone:list.some(m=>m.earned)?"ok":"off",content:awardShelf(list,newShelfState())});return;
     }
     case "code":
       if(n.ref.key.startsWith("area:"))infoSheet(n.label,n.note??"",["Группа файлов проекта по первому слову названия. Это область кода, а не подтверждённая возможность."],[["Открыть «Обнаружение»",go(()=>{mode="discovery";})]],"off");
       else infoSheet(n.label,"Файл проекта",[n.note??n.ref.key,"Назначение файла требует проверки: сканер только читает код и ничего не запускает."],[["Открыть «Обнаружение»",go(()=>{mode="discovery";})]],"off");
       return;
     case "module":infoSheet(n.label,"Модуль JUUNIBI",["Состояние: "+(n.note==="started"||n.note==="running"?"работает":n.note==="failed"?"сбой":"остановлен")+"."],[["Открыть «Модули»",()=>{location.hash="#/modules";}]],n.state==="bad"?"bad":n.state==="ok"?"ok":"off");return;
     case "history":infoSheet(n.label,"Журнал обновлений",["Запись из журнала Центра обновлений."],[["Открыть «Хронологию»",go(()=>{mode="history";})]]);return;
     case "clan":{
       const leaves=countLeaves(n);
       const target:Record<string,()=>void>={forest:()=>{mode="fox";foxView="metrics";},awards:()=>{mode="fox";foxView="awards";},updates:()=>{mode="updates";},code:()=>{mode="discovery";},modules:()=>{location.hash="#/modules";}};
       const run=target[n.ref.key];
       infoSheet(n.label,`Узлов: ${leaves}`,[`В этой ветви ${leaves} листьев. Нажмите на хаб или лист, чтобы увидеть подробности.`],run?[["Открыть раздел",go(run)]]:[]);return;
     }
   }
 }
 const FOX_HUES=[140,25,265,330,200,45,175,95,235,15];
 function foxCard(m:FoxMetric,repaint:()=>void,onNavigate?:()=>void):HTMLElement{
   const changed=foxChanged.delete(m.id);
   const article=el("article",{cls:"kt-fox-card"+(m.value===null?" is-empty":"")+(changed?" "+foxMotion(Number(m.id.slice(4))).className:"")});
   article.style.setProperty("--wh",String(FOX_HUES[m.world%10]??140));
   const fav=foxFavorites.has(m.id);
   const favorite=el("button",{type:"button",cls:"kt-fox-heart",textContent:fav?"♥":"♡",attrs:{"aria-label":(fav?"Удалить из избранного: ":"Добавить в избранное: ")+m.name,"aria-pressed":String(fav)}});
   favorite.addEventListener("click",()=>{
     if(foxFavorites.has(m.id))foxFavorites.delete(m.id);else foxFavorites.add(m.id);
     try{localStorage.setItem(favoritesKey,JSON.stringify([...foxFavorites]));}catch{/* Private storage disabled */}
     repaint();
   });
   const hourly=foxHourly[m.id]??[];
   const delta=foxPeriod===1?(hourly.length>=2?hourly[hourly.length-1]!.value-hourly[0]!.value:null):metricDelta(foxHistory[m.id]??[],foxPeriod);
   const deltaLabel=delta===null?"":(delta>0?"+":"")+delta+" за "+(foxPeriod===1?"24 часа":foxPeriod+" дней");
   const open=el("button",{type:"button",cls:"kt-fox-open",textContent:m.value===null?"Как подключить":"Источник →"});
   open.addEventListener("click",()=>{
     if(m.value===null){openConnect(m);return;}
     onNavigate?.();mode=m.target==="architecture"?"mindmap":m.target;render();
   });
   const chartPoints=foxPeriod===1?hourly.map(x=>({day:x.hour,value:x.value})):(foxHistory[m.id]??[]).filter(x=>Date.parse(x.day+"T00:00:00Z")>=Date.now()-(foxPeriod-1)*86400000);
   const plotted=sparkPoints(chartPoints);
   article.append(
     el("div",{cls:"kt-fox-card-header"},el("span",{cls:"kt-fox-emoji",textContent:m.emoji,attrs:{"aria-hidden":"true"}}),el("span",{cls:"kt-fox-world",textContent:FOX_WORLDS[m.world]?.title??""}),favorite),
     el("div",{cls:"kt-fox-valuebox"},el("strong",{cls:"kt-fox-value",textContent:m.value===null?"—":String(m.value)}),m.value===null||delta===null?null:el("small",{cls:"kt-fox-delta",textContent:deltaLabel})),
     el("h3",{textContent:m.name}),
     el("p",{textContent:m.description}),
     el("small",{cls:"kt-fox-source",textContent:(m.value===null?"Источник не подключён: ":"Источник: ")+m.source}));
   if(plotted){const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 150 34");svg.setAttribute("class","kt-fox-spark");svg.setAttribute("role","img");svg.setAttribute("aria-label","Динамика по подтверждённым измерениям");const line=document.createElementNS("http://www.w3.org/2000/svg","polyline");line.setAttribute("points",plotted);line.setAttribute("fill","none");line.setAttribute("stroke","currentColor");line.setAttribute("stroke-width","2");line.setAttribute("stroke-linecap","round");line.setAttribute("stroke-linejoin","round");svg.append(line);article.append(svg);}
   article.append(el("div",{cls:"kt-fox-card-foot"},
     el("span",{cls:"kt-fox-chip "+(m.value===null?"off":"ok"),textContent:m.value===null?"Нет данных":"Подтверждено"}),
     open));
   return article;
 }
 /** Окно «Как подключить» у пустого показателя: что нужно сделать и куда перейти. */
 function openConnect(m:FoxMetric){
   const guide=connectGuide(m.source);
   const go=guide.route?el("button",{type:"button",cls:"kt-chip is-strong",textContent:guide.routeLabel??"Открыть"}):null;
   const content=el("div",{cls:"kt-node-sheet"},
     el("p",{textContent:m.description}),
     el("div",{cls:"kt-sheet-block"},el("h4",{textContent:"Источник"}),el("p",{textContent:m.source})),
     el("div",{cls:"kt-sheet-block"},el("h4",{textContent:"Что сделать"}),el("ol",{cls:"kt-connect-steps"},...guide.steps.map(s=>el("li",{textContent:s})))),
     el("p",{cls:"muted",textContent:"Пока источник не подтвердит значение, показатель честно остаётся пустым: мы ничего не выдумываем."}),
     go?el("div",{cls:"kt-chip-row"},go):null);
   const sheet=openSheet({title:m.name,icon:"link",sub:"Нет данных · "+(FOX_WORLDS[m.world]?.title??""),tone:"off",content});
   go?.addEventListener("click",()=>{sheet.close();location.hash="#/"+guide.route;});
 }
 function foxMetricsView(main:HTMLElement,metrics:FoxMetric[]){
   const search=el("input",{cls:"kt-search",attrs:{type:"search",placeholder:"Поиск среди 100 показателей…","aria-label":"Поиск показателя"}});
   search.value=foxSearch;
   const world=el("select",{attrs:{"aria-label":"Мир показателей"}});
   world.append(el("option",{textContent:"🌍 Все 10 миров",attrs:{value:"-1"}}));
   FOX_WORLDS.forEach((x,i)=>world.append(el("option",{textContent:x.emoji+" "+x.title,attrs:{value:String(i)}})));
   world.value=String(foxWorld);
   const favoritesToggle=el("button",{type:"button",cls:"kt-chip",textContent:foxOnlyFavorite?"♥ Избранное":"♡ Избранное",attrs:{"aria-pressed":String(foxOnlyFavorite)}});
   const period=el("button",{type:"button",cls:"kt-chip",textContent:"Период: "+(foxPeriod===1?"24 часа":foxPeriod+" дней")});
   const first=el("button",{type:"button",cls:"kt-chip",textContent:"★ Любимые сверху",attrs:{"aria-pressed":String(foxFavoriteSort)}});
   const reload=el("button",{type:"button",cls:"kt-chip",textContent:"↻ Обновить"});
   const cards=el("div",{cls:"kt-fox-grid"});
   const count=el("p",{cls:"kt-fox-count",attrs:{"aria-live":"polite"}});
   const loadMore=el("button",{type:"button",cls:"kt-more",textContent:"Показать ещё"});
   const paint=()=>{
     const displayed=metrics.filter(x=>(foxWorld<0||x.world===foxWorld)&&(!foxOnlyFavorite||foxFavorites.has(x.id))&&(x.name+" "+x.description).toLocaleLowerCase("ru").includes(foxSearch.toLocaleLowerCase("ru")));
     if(foxFavoriteSort)displayed.sort((a,b)=>Number(foxFavorites.has(b.id))-Number(foxFavorites.has(a.id)));
     count.textContent="Показано: "+Math.min(foxLimit,displayed.length)+" из "+displayed.length+" · избранное: "+foxFavorites.size;
     loadMore.hidden=displayed.length<=foxLimit;
     cards.replaceChildren(...displayed.slice(0,foxLimit).map(m=>foxCard(m,paint)));
     if(!displayed.length)cards.append(el("p",{cls:"kt-empty",textContent:"Здесь пока нет подходящих показателей. Измени мир, поиск или избранное."}));
   };
   search.addEventListener("input",()=>{foxSearch=search.value;paint();});
   world.addEventListener("change",()=>{foxWorld=Number(world.value);paint();});
   favoritesToggle.addEventListener("click",()=>{foxOnlyFavorite=!foxOnlyFavorite;favoritesToggle.textContent=foxOnlyFavorite?"♥ Избранное":"♡ Избранное";favoritesToggle.setAttribute("aria-pressed",String(foxOnlyFavorite));paint();});
   period.addEventListener("click",()=>{foxPeriod=foxPeriod===1?7:foxPeriod===7?30:foxPeriod===30?90:1;period.textContent="Период: "+(foxPeriod===1?"24 часа":foxPeriod+" дней");paint();});
   first.addEventListener("click",()=>{foxFavoriteSort=!foxFavoriteSort;first.setAttribute("aria-pressed",String(foxFavoriteSort));paint();});
   reload.addEventListener("click",()=>{reload.disabled=true;foxLoading=true;void loadFox().finally(()=>{reload.disabled=false;});});
   loadMore.addEventListener("click",()=>{foxLimit=Math.min(100,foxLimit+24);paint();});
   main.append(el("div",{cls:"kt-fox-toolbar"},search,world,favoritesToggle,period,first,reload),count,cards,loadMore);
   paint();
 }
 function foxBranchesView(main:HTMLElement){
   const tracks=foxBranches(foxSnapshot,growth);
   const branchPanel=el("section",{cls:"kt-fox-branches"});
   const branchTabs=el("div",{cls:"kt-subtabs"});
   const branchList=el("div",{cls:"kt-fox-branch-list"});
   const renderBranches=()=>{
     branchTabs.replaceChildren();branchList.replaceChildren();
     for(const track of BRANCH_TRACKS){
       const amount=tracks.filter(item=>item.track===track.id).length+(foxPulls??[]).filter(pr=>foxPullTrack(pr)===track.id).length;
       const control=el("button",{type:"button",cls:"kt-chip",textContent:track.emoji+" "+track.title+" ("+amount+")",attrs:{"aria-pressed":String(foxTrack===track.id)}});
       control.addEventListener("click",()=>{foxTrack=track.id;renderBranches();});
       branchTabs.append(control);
     }
     const selectedItems=tracks.filter(item=>item.track===foxTrack);
     const matchingPRs=(foxPulls??[]).filter(pr=>foxPullTrack(pr)===foxTrack);
     for(const item of selectedItems.slice(0,30))
       branchList.append(el("article",{cls:"kt-fox-branch"},
         el("strong",{textContent:item.title}),
         el("p",{textContent:item.detail}),
         el("small",{textContent:(item.status==="planned"?"Запланировано · ":"Подтверждено · ")+item.source+(item.at?" · "+item.at:"")+(item.version?" · "+item.version.slice(0,12):"")})));
     for(const pr of matchingPRs.slice(0,15)){
       const card=el("article",{cls:"kt-fox-branch"},
         el("strong",{textContent:"Изменение #"+pr.number+" · "+pr.title}),
         el("p",{textContent:(pr.state==="merged"?"Объединён":pr.state==="open"?"Открыт — требуется продолжение":"Закрыт без слияния")+" · автопроверки: "+(pr.ci==="passed"?"успешно":pr.ci==="failed"?"ошибка":pr.ci==="pending"?"выполняется":"нет подтверждения")}),
         el("small",{textContent:"GitHub · "+(pr.mergedAt??pr.createdAt).slice(0,10)+(pr.sha?" · "+pr.sha.slice(0,12):"")}));
       card.append(el("a",{textContent:"Открыть изменение ↗",attrs:{href:pr.url,target:"_blank",rel:"noopener noreferrer"}}));
       branchList.append(card);
     }
     if(!selectedItems.length&&!matchingPRs.length)branchList.append(el("p",{cls:"kt-empty",textContent:foxPullsLoading?"Загружается журнал GitHub…":foxPulls===null?"GitHub недоступен — показаны только локальные сведения.":foxSnapshot?"Записей этого типа пока нет.":"Источники ещё не предоставили данные."}));
   };
   renderBranches();branchPanel.append(branchTabs,branchList);
   branchPanel.append(el("p",{cls:"kt-fox-count",textContent:"GitHub: "+(foxPulls===null?"нет данных":foxPulls.length+" последних изменений")+" · классификация по заголовкам изменений приблизительная; установка подтверждается только локальным журналом."}));
   main.append(branchPanel);
 }
 function renderFox(){
   const metrics=foxMetrics({nodes:nodesOf(),snapshot:foxSnapshot,growth,live:foxLive});
   const medals=medalItems(metrics,foxHistory);
   const main=el("section",{cls:"kt-fox-main",attrs:{"aria-label":"Лес"}});
   const head=foxView==="metrics"?["Показатели","100 показателей в 10 мирах. Каждый знает свой источник; без источника честно написано «Нет данных»."]
     :foxView==="awards"?["Награды","Награды выдаются только за подтверждённые данные. Бронза, серебро, золото и легенда показывают сложность награды; если источника нет, награда остаётся закрытой."]
     :["Ветки проекта","Обновления, правки, ошибки и продолжение — по журналу установок и последним изменениям на GitHub."];
   const shownCount=foxView==="metrics"?metrics.filter(x=>x.value!==null).length+" из "+metrics.length:foxView==="awards"?medals.filter(m=>m.earned).length+" из "+medals.length:"";
   main.append(sectionHead("fox",shownCount),el("p",{cls:"km-lead muted",textContent:head[1]!}));
   if(foxView==="metrics")foxMetricsView(main,metrics);
   else if(foxView==="awards")main.append(awardShelf(medals,shelfState));
   else foxBranchesView(main);
   body.replaceChildren(main);
   status.textContent=foxLoading?"Получаем данные…":"";
 }
 void fetch("/api/kitsune/evolution").then(async response=>{
   if(!response.ok)throw new Error("Серверная карта недоступна");
   const snapshot=await response.json() as EvolutionSnapshot;
   dynamicNodes=validateEvolutionManifest(snapshot.manifest).nodes;
   persistedHistory=snapshot.timeline;
   refreshReleases();
   // Without Python 3 the stored histories cannot work: say so plainly instead of silently showing less.
   const problem=snapshot.python&&!snapshot.python.ok?snapshot.python.reason:snapshot.warning;
   notice.textContent=problem??"";notice.hidden=!problem;
   foxSnapshot=snapshot;
   const latest=growth.find(x=>x.kind==="new"||x.kind==="rollback"||x.kind==="installed");
   foxReaction=latest?latest.kind==="rollback"?"🦊 Уф! Лес вернулся к прежней версии. Всё под контролем.":latest.kind==="new"?"🌱 Ой, лапки! У нас появилась новая веточка: "+latest.title:"✨ Обновление установлено — проверим, что изменилось!":"";
   growth=growthEvents(snapshot);
   const dailyEvents:ForestEvent[]=growth.map(item=>({id:item.id,day:new Date().toISOString().slice(0,10),kind:item.kind==="new"?"growth":item.kind==="rollback"?"recovery":item.kind==="removed"?"warning":"update",title:item.title,detail:item.detail}));
   foxEvents=mergeForestEvents(foxEvents,dailyEvents);
   try{localStorage.setItem(eventStoreKey,JSON.stringify(foxEvents));}catch{/* Storage optional */}
   const eventKey=snapshot.timeline.activeVersion+":"+growth.map(x=>x.id).join(",");
   playedEvent=eventKey;
   activeVersion=snapshot.timeline.activeVersion;
   discovery=snapshot.discovery??null;
   render();
 }).catch(()=>{ /* Older server: use built-in verified catalog. */ });
 void Promise.all([api.updateStatus(),api.updateHistory()]).then(([st,h])=>{
   updateStatusValue=st.ok?st.value:null;updateHistoryValue=h.ok?h.value:null;refreshReleases();
   updatesLoading=false;
   render();
 }).catch(()=>{updatesLoading=false;render();});
 const loadFox=()=>Promise.allSettled([
   api.modules(),api.brainStatus(),api.achievements(),api.diskLife(),api.organizer(),api.updateStatus(),api.projectStats()
 ]).then(results=>{
   const read=<T,>(index:number):T|undefined=>{
     const outcome=results[index];
     if(outcome?.status!=="fulfilled"||!outcome.value.ok)return undefined;
     return outcome.value.value as T;
   };
   foxLive={};
   const modules=read<import("../api").ModuleInfo[]>(0);if(modules)foxLive.modules=modules;
   const brain=read<import("../api").BrainStatus>(1);if(brain)foxLive.brain=brain;
   const achievements=read<import("../api").AchievementsData>(2);if(achievements)foxLive.achievements=achievements;
   const disk=read<import("../api").DiskLife>(3);if(disk)foxLive.disk=disk;
   const organizer=read<import("../api").Organizer>(4);if(organizer)foxLive.organizer=organizer;
   const updater=read<import("../api").UpdateStatus>(5);if(updater)foxLive.updater=updater;
   const project=read<import("../api").ProjectStatsData>(6);if(project)foxLive.project=project;
   foxLoading=false;
   const fresh=foxMetrics({nodes:nodesOf(),snapshot:foxSnapshot,growth,live:foxLive});
   foxChanged=foxChangedMetrics(foxKnownNumbers,fresh);
   foxKnownNumbers=foxVerifiedReadings(fresh);
   foxHistory=recordMetrics(foxHistory,foxMetrics({nodes:nodesOf(),snapshot:foxSnapshot,growth,live:foxLive}),new Date().toISOString().slice(0,10));
   saveHistory(foxHistory);
   void synchronizeFoxHistory(fresh,foxEvents).then(record=>{
     if(!record)return;
     foxHistory={...foxHistory,...record.daily};
     foxHourly=record.hourly;
     foxEvents=mergeForestEvents(foxEvents,record.events);
     saveHistory(foxHistory);
     if(mode==="fox")render();
   });
   if(mode==="fox")render();
 }).catch(()=>{foxLoading=false;if(mode==="fox")render();});
 void getFoxPulls().then(async prs=>{
   foxPulls=prs;foxPullsLoading=false;
   if(mode==="fox")render();
   if(prs?.length){foxPulls=await refreshFoxChecks(prs);if(mode==="fox")render();}
 }).catch(()=>{foxPullsLoading=false;if(mode==="fox")render();});
 void loadFox();
 render();return root;
}
