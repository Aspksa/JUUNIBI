import {readHistory,saveHistory,recordMetrics,metricDelta,forestMood,type FoxHistory} from "./kitsune-fox-history";
import {FOX_WORLDS,foxMetrics,type FoxLive} from "./kitsune-fox-metrics";
import {growthEvents,type GrowthEvent} from "./kitsune-growth";
import {downstreamImpact,compareManifests,architectureQuestion} from "./kitsune-impact";
import { traceCapabilities, evolutionChronology, architecturePrompt } from "./kitsune-lineage";
import { buildGraph } from "./kitsune-graph";
import { validateEvolutionManifest, recommendEvolution, type EvolutionNode, type EvolutionSnapshot } from "./kitsune-evolution-model";
import { el } from "../dom";
import { pageHead } from "./kit";
import { api } from "../api";
import { evolutionFromUpdater, evolutionStateLabel, type EvolutionRelease } from "./kitsune-updates";

export type TreeMode = "architecture" | "development" | "connections" | "updates" | "architect" | "history" | "versions" | "impact" | "comparison" | "brain-chat" | "discovery" | "growth" | "fox";
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
 let mode:TreeMode="architecture",selected="brain",filter="";
 let releases:EvolutionRelease[]=[];
 let dynamicNodes:EvolutionNode[]|null=null;
 let persistedHistory:EvolutionSnapshot["timeline"]|null=null;
 let graphZoom=1;
 let focusNext=false;
 let updatesLoading=true;
 let discovery:EvolutionSnapshot["discovery"]|null=null;
 let brainMessages:{role:"user"|"assistant";text:string}[]=[];
 let brainBusy=false;
 let growth:GrowthEvent[]=[];
 let activeVersion="";
 let graphMotion:"bloom"|"pulse"|"recovery"|"none"="none";
 let playedEvent="";
 let foxWorld=-1;
 let foxOnlyFavorite=false;
 let foxSearch="";
 let foxSnapshot:EvolutionSnapshot|null=null;
 let foxLive:FoxLive={};
 let foxLoading=true;
 let foxReaction="";
 let foxPeriod:7|30=7;
 let foxHistory:FoxHistory=readHistory();
 let foxFavoriteSort=false;
 const favoritesKey="juunibi:fox-commotion:favorites:v1";
 let foxFavorites=new Set<string>();
 try{const saved=JSON.parse(localStorage.getItem(favoritesKey)??"[]") as unknown;if(Array.isArray(saved))foxFavorites=new Set(saved.filter((x):x is string=>typeof x==="string"&&/^fox-(?:[0-9]|[1-9][0-9])$/.test(x)));}catch{/* Private storage disabled */}
 const body=el("div",{cls:"kt-layout"});
 const status=el("p",{cls:"muted",attrs:{"aria-live":"polite"}});
 const root=el("div",{cls:"page kitsune-tree"},pageHead("link","Лисье древо","KITSUNE TREE · Живая карта архитектуры и развития JUUNIBI"),
   el("p",{cls:"muted",textContent:"Карта основана на известных компонентах проекта и подтверждённых PR. Будущие возможности отмечены отдельно. Установленные версии берутся из Центра обновлений; связи новых релизов с ветвями определяются предположительно по описанию."}),status,body);
 const query=el("input",{cls:"kt-search",attrs:{type:"search",placeholder:"Найти ветвь…","aria-label":"Поиск ветви"}});
 query.addEventListener("input",()=>{filter=query.value.toLocaleLowerCase("ru");render();});
 const controls=el("div",{cls:"kt-controls"},query);
 const overview=el("section",{cls:"kt-overview",attrs:{"aria-label":"Состояние эволюции"}});
 root.insertBefore(overview,body);
 root.insertBefore(controls,body);
 const navLabel=el("p",{cls:"kt-nav-label",textContent:"Разделы развития"});
 controls.prepend(navLabel);
 const renderOverview=()=>{
   const nodes=nodesOf();
   const verified=nodes.filter(n=>n.status==="implemented").length;
   overview.replaceChildren(
     el("div",{cls:"kt-overview-intro"},
       el("span",{cls:"kt-eyebrow",textContent:"JUUNIBI / KITSUNE SYSTEM"}),
       el("h2",{textContent:"Живая архитектура"}),
       el("p",{textContent:"Исследуйте возможности, просматривайте проверенные изменения и наблюдайте развитие проекта."})),
     ...([["Ветви",String(nodes.length)],["Реализовано",String(verified)],["Связи",String(nodes.reduce((n,x)=>n+x.dependsOn.length,0))],["Новые события",String(growth.length)]] as [string,string][])
       .map(([name,count])=>el("div",{cls:"kt-overview-stat"},el("strong",{textContent:count}),el("span",{textContent:name})))
   );
 };
 const tabs=el("div",{cls:"kt-tabs"});
 controls.prepend(tabs);
 const nodesOf=()=>dynamicNodes??TREE_NODES;
 function render(){
   renderOverview();
   tabs.replaceChildren(...([["architecture","Архитектура"],["development","Развитие"],["connections","Связи"],["updates","Обновления"],["architect","ИИ-архитектор"],["history","Хронология"],["versions","Версии ветвей"],["impact","Влияние"],["comparison","Сравнение"],["brain-chat","Brain-диалог"],["discovery","Автообнаружение"],["growth","Живой рост"],["fox","🦊 Лисий переполох"]] as [TreeMode,string][]).map(([value,label])=>{
     const b=el("button",{cls:mode===value?"kt-active":"",textContent:label,attrs:{"aria-pressed":String(mode===value)}});
     b.addEventListener("click",()=>{mode=value;render();});return b;
   }));
   if(mode==="fox"){
     const metrics=foxMetrics({nodes:nodesOf(),snapshot:foxSnapshot,growth,live:foxLive});
     const mood=forestMood(metrics);
     const main=el("section",{cls:"kt-fox-main",attrs:{"aria-label":"Лисий переполох — сто живых показателей"}});
     main.append(el("div",{cls:"kt-fox-hero"},
       el("span",{cls:"kt-eyebrow",textContent:"JUUNIBI / FOX COMMOTION"}),
       el("h2",{textContent:"🦊 Лисий переполох"}),
       el("p",{textContent:"100 лесных историй в 10 мирах. Значения берутся из подтверждённых данных; неизвестные показатели честно показывают «Нет данных»."})));
     main.append(el("p",{cls:"kt-fox-reaction",textContent:mood.emoji+" "+mood.label+" · "+mood.detail}));
     if(foxReaction)main.append(el("p",{cls:"kt-fox-reaction",attrs:{"aria-live":"polite"},textContent:foxReaction}));
     const view=el("div",{cls:"kt-fox-toolbar"});
     const search=el("input",{cls:"kt-search",attrs:{type:"search",placeholder:"Поиск среди 100 показателей…","aria-label":"Поиск показателя"}});
     search.value=foxSearch;
     const world=el("select",{attrs:{"aria-label":"Мир показателей"}});
     world.append(el("option",{textContent:"🌍 Все 10 миров",attrs:{value:"-1"}}));
     FOX_WORLDS.forEach((x,i)=>world.append(el("option",{textContent:x.emoji+" "+x.title,attrs:{value:String(i)}})));
     world.value=String(foxWorld);
     const favoritesToggle=el("button",{textContent:foxOnlyFavorite?"♥ Избранное":"♡ Показать избранное",attrs:{"aria-pressed":String(foxOnlyFavorite)}});
     const period=el("button",{textContent:foxPeriod+" дней"});
     period.addEventListener("click",()=>{foxPeriod=foxPeriod===7?30:7;period.textContent=foxPeriod+" дней";paint();});
     const cards=el("div",{cls:"kt-fox-grid"});
     const count=el("p",{cls:"kt-fox-count",attrs:{"aria-live":"polite"}});
     const paint=()=>{
       const displayed=metrics.filter(x=>(foxWorld<0||x.world===foxWorld)&&(!foxOnlyFavorite||foxFavorites.has(x.id))&&(x.name+" "+x.description).toLocaleLowerCase("ru").includes(foxSearch.toLocaleLowerCase("ru")));
       count.textContent="Найдено: "+displayed.length+" из 100 · Избранное: "+foxFavorites.size;
       cards.replaceChildren();
       for(const m of displayed){
         const article=el("article",{cls:"kt-fox-card"});
         const favorite=el("button",{cls:"kt-fox-heart",textContent:foxFavorites.has(m.id)?"♥":"♡",attrs:{"aria-label":(foxFavorites.has(m.id)?"Удалить из избранного: ":"Добавить в избранное: ")+m.name,"aria-pressed":String(foxFavorites.has(m.id))}});
         favorite.addEventListener("click",()=>{
           if(foxFavorites.has(m.id))foxFavorites.delete(m.id);else foxFavorites.add(m.id);
           try{localStorage.setItem(favoritesKey,JSON.stringify([...foxFavorites]));}catch{/* Private storage disabled */}
           paint();
         });
         const delta=metricDelta(foxHistory[m.id]??[],foxPeriod);
         const label=delta===null?"История накапливается":(delta>0?"+":"")+delta+" за "+foxPeriod+" дней";
         const open=el("button",{cls:"kt-fox-open",textContent:"Открыть источник →"});
         open.disabled=m.value===null;
         open.addEventListener("click",()=>{mode=m.target;render();});
         article.append(
           el("div",{cls:"kt-fox-card-header"},el("span",{cls:"kt-fox-emoji",textContent:m.emoji}),favorite),
           el("strong",{cls:"kt-fox-value",textContent:m.value===null?"—":String(m.value)}),
           el("h3",{textContent:m.name}),
           el("small",{cls:"kt-fox-delta",textContent:label}),
           el("p",{textContent:m.description}),
           el("small",{textContent:m.value===null?"Нет данных · "+m.source:m.source}),
           open
         );cards.append(article);
       }
       if(!displayed.length)cards.append(el("p",{cls:"kt-empty",textContent:"Здесь пока нет подходящих показателей. Измени мир, поиск или избранное."}));
     };
     search.addEventListener("input",()=>{foxSearch=search.value;paint();});
     world.addEventListener("change",()=>{foxWorld=Number(world.value);paint();});
     favoritesToggle.addEventListener("click",()=>{foxOnlyFavorite=!foxOnlyFavorite;favoritesToggle.textContent=foxOnlyFavorite?"♥ Избранное":"♡ Показать избранное";favoritesToggle.setAttribute("aria-pressed",String(foxOnlyFavorite));paint();});
     view.append(search,world,favoritesToggle,period);
     main.append(view,count,cards);
     const side=el("aside",{cls:"kt-detail"},
       el("span",{cls:"kt-eyebrow",textContent:"10 МИРОВ · 100 ПОКАЗАТЕЛЕЙ"}),
       el("h2",{textContent:"Как живёт лес"}),
       el("p",{textContent:"Каждый показатель знает источник. Число 0 означает подтверждённое отсутствие событий. «Нет данных» означает, что нужный источник пока не подключён."}),
       el("p",{textContent:"Избранные карточки сохраняются только в этом браузере. Никакие действия с проектом не выполняются."}));
     const availability=metrics.filter(x=>x.value!==null).length;
     side.append(el("p",{cls:"kt-state",textContent:"Доступно значений: "+availability+" из 100"+(foxLoading?" · Получение данных…":"")}));
     body.replaceChildren(main,side);
     paint();status.textContent="Лисий переполох · 100 показателей, "+availability+" с подключёнными данными";return;
   }
   if(mode==="growth"){
     const timeline=el("div",{cls:"kt-growth-timeline",attrs:{"aria-label":"Подтверждённые события роста"}});
     if(!growth.length)timeline.append(el("p",{cls:"kt-empty",textContent:"Подтверждённых изменений между двумя сохранёнными манифестами пока нет. Эффекты появятся после установки нового релиза и получения обоих снимков."}));
     for(const item of growth){
       const card=el("article",{cls:"kt-growth-event kt-growth-"+item.kind},
         el("span",{cls:"kt-growth-orb",attrs:{"aria-hidden":"true"}}),
         el("div",{},el("strong",{textContent:item.title}),el("small",{textContent:item.detail})));
       if(item.nodeId&&nodesOf().some(n=>n.id===item.nodeId)){
         const go=el("button",{textContent:"Открыть ветвь →"});
         go.addEventListener("click",()=>{selected=item.nodeId!;mode="architecture";render();});
         card.append(go);
       }
       timeline.append(card);
     }
     const side=el("aside",{cls:"kt-detail"},
       el("span",{cls:"kt-eyebrow",textContent:"GROWTH / VERIFIED"}),
       el("h2",{textContent:"Рост без иллюзий"}),
       el("p",{textContent:"Визуальные эффекты отображают только изменения между подтверждёнными снимками установленной архитектуры. Кандидаты сканера находятся в отдельном разделе."}),
       el("p",{cls:"kt-state",textContent:"Установленная версия: "+(activeVersion.slice(0,12)||"не определена")}));
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
         el("p",{textContent:data.manifestGaps.join(", ")||"Нет"}));
       const prompt=el("button",{textContent:"Подготовить анализ Brain"});
       prompt.addEventListener("click",()=>{
         const context="Сделай архитектурный аудит JUUNIBI на основании кандидатов, не считая их реализованными возможностями: "+data.candidates.slice(0,20).map(x=>x.file).join(", ")+". Предложи проверки и связи; не меняй проект.";
         const field=el("textarea",{textContent:context,attrs:{readonly:"true","aria-label":"Анализ новых кандидатов"}});
         prompt.replaceWith(field);
       });side.append(prompt);
     }
     body.replaceChildren(panel,side);
     status.textContent=data?"Найдено "+data.candidates.length+" возможных новых модулей":"Сканер пока недоступен";return;
   }
   if(mode==="impact"){
     const all=nodesOf(),target=all.find(n=>n.id===selected)??all[0]!;
     const affected=downstreamImpact(all,target.id);
     const pane=el("div",{cls:"kt-graph"});
     const choose=el("select",{attrs:{"aria-label":"Исходная ветвь"}});
     for(const n of all){const opt=el("option",{textContent:n.title,attrs:{value:n.id}});if(n.id===target.id)opt.selected=true;choose.append(opt);}
     choose.addEventListener("change",()=>{selected=choose.value;render();});
     pane.append(choose,el("p",{textContent:"Зависимые ветви: "+affected.length}));
     for(const a of affected)pane.append(el("article",{cls:"kt-node"},el("strong",{textContent:a.title}),
        el("small",{textContent:"Глубина связи: "+a.distance+" · "+a.status})));
     body.replaceChildren(pane,el("aside",{cls:"kt-detail"},el("h2",{textContent:"Анализ влияния"}),
       el("p",{textContent:"Показывает все транзитивные зависимости. Это структурный анализ манифеста, не прогноз фактического сбоя."})));
     status.textContent=affected.length+" ветвей зависят от "+target.title;return;
   }
   if(mode==="comparison"){
     const versions=persistedHistory?.snapshots??[];
     const pane=el("div",{cls:"kt-graph"});
     const side=el("aside",{cls:"kt-detail"},el("h2",{textContent:"Сравнение версий"}),
       el("p",{textContent:"Каждый сохранённый манифест закреплён за SHA установленной версии. Изменения вычисляются только между реальными снимками."}));
     if(versions.length<2){
       pane.append(el("p",{textContent:"Для сравнения нужны минимум две последовательно установленные версии с записанными манифестами. Снимки появятся автоматически при открытии дерева после установки."}));
     }else{
       const controls=el("div",{cls:"kt-tabs"});
       const before=el("select",{attrs:{"aria-label":"Предыдущая версия"}}),after=el("select",{attrs:{"aria-label":"Новая версия"}});
       for(const v of versions){
         before.append(el("option",{attrs:{value:v.version},textContent:v.version.slice(0,12)}));
         after.append(el("option",{attrs:{value:v.version},textContent:v.version.slice(0,12)}));
       }
       before.value=versions[1]!.version;after.value=versions[0]!.version;
       const result=el("div",{cls:"kt-comparison"});
       const show=()=>{
         const x=versions.find(v=>v.version===before.value),y=versions.find(v=>v.version===after.value);
         result.replaceChildren();
         if(!x||!y)return;
         const d=compareManifests(x.manifest.nodes,y.manifest.nodes);
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
     for(const m of brainMessages)dialog.append(el("p",{cls:"kt-brain-"+m.role,textContent:(m.role==="user"?"Вы: ":"Brain: ")+m.text}));
     const node=nodesOf().find(n=>n.id===selected)??nodesOf()[0]!;
     const question=el("textarea",{cls:"kt-brain-input",attrs:{placeholder:"Вопрос по развитию "+node.title,"aria-label":"Вопрос Brain"}});
     const ask=el("button",{textContent:brainBusy?"Анализ выполняется…":"Спросить Brain",attrs:{type:"button"}});
     ask.disabled=brainBusy;
     ask.addEventListener("click",()=>{
       const text=question.value.trim();if(!text||brainBusy)return;
       const prompt=architectureQuestion(nodesOf(),selected,text);
       brainMessages.push({role:"user",text});brainBusy=true;render();
       void api.chat(prompt).then(r=>{
         brainMessages.push({role:"assistant",text:r.ok?r.value.reply:"Ошибка Brain: "+r.error.message});
       }).catch(()=>brainMessages.push({role:"assistant",text:"Brain недоступен"})).finally(()=>{brainBusy=false;render();});
     });
     pane.append(el("p",{textContent:"Контекст ветви: "+node.title}),dialog,question,ask);
     const side=el("aside",{cls:"kt-detail"},el("h2",{textContent:"Brain-диалог"}),
       el("p",{textContent:"Запрос отправляется только по нажатию кнопки. Действия помощницы могут требовать отдельного разрешения; этот экран не выполняет изменения проекта."}));
     const change=el("select",{attrs:{"aria-label":"Ветка для Brain"}});
     for(const n of nodesOf()){const opt=el("option",{textContent:n.title,attrs:{value:n.id}});if(n.id===selected)opt.selected=true;change.append(opt);}
     change.addEventListener("change",()=>{selected=change.value;render();});side.append(change);
     body.replaceChildren(pane,side);status.textContent="Диалог с Brain по выбранной ветви";return;
   }
   if(mode==="history"||mode==="versions"){
     const history=persistedHistory?.history??[];
     const list=el("div",{cls:"kt-graph"});
     if(mode==="history"){
       for(const event of evolutionChronology(history)){
         if(!(event.description+" "+event.version).toLowerCase().includes(filter))continue;
         list.append(el("article",{cls:"kt-node"},el("strong",{textContent:event.kind==="install"?"Установка":event.kind==="rollback"?"Откат":"Событие"}),
           el("small",{textContent:event.at+" · "+event.version.slice(0,12)}),el("p",{textContent:event.description})));
       }
     }else{
       for(const item of traceCapabilities(nodesOf(),persistedHistory?.activeVersion??"",history)){
         if(!item.title.toLowerCase().includes(filter))continue;
         const card=el("article",{cls:"kt-node"},el("strong",{textContent:item.title}),
           el("small",{textContent:item.origin?"PR #"+item.origin.pr+" · "+item.origin.sha.slice(0,12):"Нет точного SHA"}),
           el("p",{textContent:item.installation==="current"?"Совпадает с активным SHA":item.installation==="recorded"?"SHA есть в журнале":"Наличие способности в установленной версии не подтверждено"}));
         if(item.origin)card.append(el("a",{textContent:"Исходный PR",attrs:{href:"https://github.com/Aspksa/JUUNIBI/pull/"+item.origin.pr,target:"_blank",rel:"noopener noreferrer"}}));
         list.append(card);
       }
     }
     if(!list.childNodes.length)list.append(el("p",{textContent:"Нет подтверждённых записей."}));
     body.replaceChildren(list,el("aside",{cls:"kt-detail"},el("h2",{textContent:mode==="history"?"Хронология обновлений":"Происхождение возможностей"}),
       el("p",{textContent:"Данные подтверждаются журналом Центра обновлений и точным SHA релиза. Совпадение названия не означает подтверждённую установку."})));
     status.textContent=mode==="history"?"История установок и откатов":"Происхождение ветвей по SHA и PR";return;
   }
   if(mode==="updates"){
     status.textContent=updatesLoading?"Загружаю историю Центра обновлений…":
       "История установок и текущая версия из Центра обновлений";
     const timeline=el("div",{cls:"kt-graph"});
     if(!releases.length)timeline.append(el("p",{cls:"muted",textContent:updatesLoading?"Загрузка…":"Установок в истории пока нет. Откройте Центр обновлений для проверки версии."}));
     for(const release of releases.filter(x=>(x.title+" "+x.description+" "+x.version).toLocaleLowerCase("ru").includes(filter))){
       const card=el("article",{cls:"kt-node"},
         el("strong",{textContent:release.title}),
         el("small",{textContent:evolutionStateLabel[release.state]+" · "+release.version}),
         el("p",{textContent:release.description}),
         el("small",{textContent:release.relatedBranches.length?
           "Предполагаемые ветви: "+release.relatedBranches.join(", "):"Ветви не определены"}));
       if(release.evidence)card.append(el("a",{textContent:"Изменение в GitHub ↗",attrs:{href:release.evidence,target:"_blank",rel:"noopener noreferrer"}}));
       timeline.append(card);
     }
     if(persistedHistory)timeline.prepend(el("p",{cls:"muted",textContent:"SQLite: "+persistedHistory.history.length+" событий · активная версия "+persistedHistory.activeVersion}));
     const side=el("aside",{cls:"kt-detail"},el("h2",{textContent:"Центр обновлений"}),
       el("p",{textContent:"Скачивание само по себе не активирует ветку. Статус «Установлено» появляется только после записи об установке; откат сохраняется в истории."}));
     const link=el("a",{textContent:"Открыть Центр обновлений →",attrs:{href:"#update"}});
     side.append(link);body.replaceChildren(timeline,side);return;
   }
   const allNodes=nodesOf();
   if(mode==="architect"){
     const advice=recommendEvolution({schemaVersion:1,project:"JUUNIBI",nodes:allNodes});
     const adviceHost=el("div",{cls:"kt-graph"});
     adviceHost.append(el("p",{cls:"muted",textContent:"Правила зависимостей, не генеративный ИИ. Предложения не изменяют проект автоматически."}));
     for(const row of advice){
       const node=allNodes.find(n=>n.id===row.nodeId)!;
       const prompt=architecturePrompt(node,allNodes);
       const button=el("button",{textContent:"Подготовить запрос Brain",attrs:{type:"button"}});
       button.addEventListener("click",()=>{
         const panel=el("textarea",{attrs:{readonly:"true","aria-label":"Запрос для анализа Brain"},textContent:prompt});
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
   const matched=allNodes.filter(n=>(n.title+" "+n.description).toLocaleLowerCase("ru").includes(filter));
   status.textContent=`${allNodes.filter(n=>n.status==="implemented").length} реализовано · ${allNodes.filter(n=>n.status==="planned").length} запланировано · ${allNodes.flatMap(n=>n.dependsOn).length} связей`;
   const graph=el("div",{cls:"kt-graph",attrs:{"aria-label":"Ветви эволюции"}});
   if(mode==="development") {graph.style.transformOrigin="top left";graph.style.scale=String(graphZoom);}
   const nodes=mode==="development"?[...matched].sort((a,b)=>a.stage-b.stage):matched;
   if(mode==="architecture"||mode==="connections") {graph.append(buildGraph(nodes,selected,id=>{selected=id;focusNext=true;render();},graphZoom,new Set(growth.filter(x=>x.kind==="new").map(x=>x.nodeId).filter((id):id is string=>Boolean(id))),graphMotion,focusNext));focusNext=false;graphMotion="none";}
   else for(const node of nodes){
     const card=el("button",{cls:"kt-node "+(node.id===selected?"kt-selected ":"")+(node.status==="planned"?"kt-future":""),
       attrs:{"aria-pressed":String(node.id===selected)},
       title:node.description},el("span",{cls:"kt-node-title",textContent:node.title}),
       el("small",{textContent:node.status==="planned"?"Запланировано":`Уровень ${node.stage} · реализовано`}));
     card.addEventListener("click",()=>{selected=node.id;render();});
     graph.append(card);
   }
   const current=allNodes.find(n=>n.id===selected)??allNodes[0]!;
   const parents=current.dependsOn.map(id=>allNodes.find(n=>n.id===id)?.title??id);
   const children=allNodes.filter(n=>n.dependsOn.includes(current.id)).map(n=>n.title);
   const details=el("aside",{cls:"kt-detail"},
      el("h2",{textContent:current.title}),
      el("p",{textContent:current.description}),
      el("h3",{textContent:"Как работает"}),el("p",{textContent:current.how}),
      el("h3",{textContent:"Зависит от"}),el("p",{textContent:parents.join(" · ")||"Корневой компонент"}),
      el("h3",{textContent:"Связанные ветви"}),el("p",{textContent:children.join(" · ")||"Пока нет"}),
      el("p",{cls:"kt-state",textContent:current.status==="implemented"?"Подтверждено в проекте":"План развития, не реализовано"}));
   if(current.evidence){const link=el("a",{textContent:"Открыть подтверждающий PR ↗",attrs:{href:current.evidence,target:"_blank",rel:"noopener noreferrer"}});details.append(link);}
   if(mode==="connections"){
     const list=el("div",{cls:"kt-edges"});
     for(const edge of allNodes.flatMap(n=>n.dependsOn.map(from=>({from,to:n.id}))).filter(e=>e.from===selected||e.to===selected)){
       const n=allNodes.find(x=>x.id===(edge.from===selected?edge.to:edge.from));
       if(!n)continue;
       const button=el("button",{textContent:`${edge.from===selected?"Зависит от этой ветви":"Зависимость"} → ${n.title}`});
       button.addEventListener("click",()=>{selected=n.id;render();});list.append(button);
     }
     details.append(el("h3",{textContent:"Переходы по связям"}),list);
   }
   body.replaceChildren(graph,details);
 }
 const zoom=el("div",{cls:"kt-zoom"});
 for(const [label,value] of [["−",-0.15],["+",0.15],["100%",0]] as [string,number][]){
   const b=el("button",{textContent:label});
   b.addEventListener("click",()=>{graphZoom=value===0?1:Math.max(.6,Math.min(1.5,graphZoom+value));render();});zoom.append(b);
 }
 controls.append(zoom);
 void fetch("/api/kitsune/evolution").then(async response=>{
   if(!response.ok)throw new Error("Серверная карта недоступна");
   const snapshot=await response.json() as EvolutionSnapshot;
   dynamicNodes=validateEvolutionManifest(snapshot.manifest).nodes;
   persistedHistory=snapshot.timeline;
   foxSnapshot=snapshot;
   const latest=growth.find(x=>x.kind==="new"||x.kind==="rollback"||x.kind==="installed");
   foxReaction=latest?latest.kind==="rollback"?"🦊 Уф! Лес вернулся к прежней версии. Всё под контролем.":latest.kind==="new"?"🌱 Ой, лапки! У нас появилась новая веточка: "+latest.title:"✨ Обновление установлено — проверим, что изменилось!":"";
   growth=growthEvents(snapshot);
   const eventKey=snapshot.timeline.activeVersion+":"+growth.map(x=>x.id).join(",");
   if(growth.length&&playedEvent!==eventKey){
     playedEvent=eventKey;
     graphMotion=growth.some(x=>x.kind==="rollback")?"recovery":growth.some(x=>x.kind==="new")?"bloom":"pulse";
   }
   activeVersion=snapshot.timeline.activeVersion;
   discovery=snapshot.discovery??null;
   render();
 }).catch(()=>{ /* Older server: use built-in verified catalog. */ });
 void Promise.all([api.updateStatus(),api.updateHistory()]).then(([st,h])=>{
   releases=evolutionFromUpdater(st.ok?st.value:null,h.ok?h.value:null);
   updatesLoading=false;
   render();
 }).catch(()=>{updatesLoading=false;render();});
 void Promise.allSettled([
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
   foxHistory=recordMetrics(foxHistory,foxMetrics({nodes:nodesOf(),snapshot:foxSnapshot,growth,live:foxLive}),new Date().toISOString().slice(0,10));
   saveHistory(foxHistory);
   if(mode==="fox")render();
 }).catch(()=>{foxLoading=false;if(mode==="fox")render();});
 render();return root;
}
