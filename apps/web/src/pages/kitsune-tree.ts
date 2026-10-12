import {downstreamImpact,compareManifests,architectureQuestion} from "./kitsune-impact";
import { traceCapabilities, evolutionChronology, architecturePrompt } from "./kitsune-lineage";
import { buildGraph } from "./kitsune-graph";
import { validateEvolutionManifest, recommendEvolution, type EvolutionNode, type EvolutionSnapshot } from "./kitsune-evolution-model";
import { el } from "../dom";
import { pageHead } from "./kit";
import { api } from "../api";
import { evolutionFromUpdater, evolutionStateLabel, type EvolutionRelease } from "./kitsune-updates";

export type TreeMode = "architecture" | "development" | "connections" | "updates" | "architect" | "history" | "versions" | "impact" | "comparison" | "brain-chat";
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
 let updatesLoading=true;
 let brainMessages:{role:"user"|"assistant";text:string}[]=[];
 let brainBusy=false;
 const body=el("div",{cls:"kt-layout"});
 const status=el("p",{cls:"muted",attrs:{"aria-live":"polite"}});
 const root=el("div",{cls:"page kitsune-tree"},pageHead("link","Лисье древо","KITSUNE TREE · Живая карта архитектуры и развития JUUNIBI"),
   el("p",{cls:"muted",textContent:"Карта основана на известных компонентах проекта и подтверждённых PR. Будущие возможности отмечены отдельно. Установленные версии берутся из Центра обновлений; связи новых релизов с ветвями определяются предположительно по описанию."}),status,body);
 const query=el("input",{cls:"kt-search",attrs:{type:"search",placeholder:"Найти ветвь…","aria-label":"Поиск ветви"}});
 query.addEventListener("input",()=>{filter=query.value.toLocaleLowerCase("ru");render();});
 const controls=el("div",{cls:"kt-controls"},query);
 root.insertBefore(controls,body);
 const tabs=el("div",{cls:"kt-tabs"});
 controls.prepend(tabs);
 const nodesOf=()=>dynamicNodes??TREE_NODES;
 function render(){
   tabs.replaceChildren(...([["architecture","Архитектура"],["development","Развитие"],["connections","Связи"],["updates","Обновления"],["architect","ИИ-архитектор"],["history","Хронология"],["versions","Версии ветвей"],["impact","Влияние"],["comparison","Сравнение"],["brain-chat","Brain-диалог"]] as [TreeMode,string][]).map(([value,label])=>{
     const b=el("button",{cls:mode===value?"kt-active":"",textContent:label,attrs:{"aria-pressed":String(mode===value)}});
     b.addEventListener("click",()=>{mode=value;render();});return b;
   }));
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
     const versions=persistedHistory?.history.filter(h=>h.kind==="install")??[];
     const pane=el("div",{cls:"kt-graph"},el("p",{textContent:"Доступен текущий манифест. Для достоверного сравнения двух версий необходимы сохранённые манифесты обеих версий."}));
     const diff=compareManifests(nodesOf(),nodesOf());
     pane.append(el("p",{textContent:"Текущий снимок: "+diff.unchanged.length+" ветвей; известных установок: "+versions.length}));
     body.replaceChildren(pane,el("aside",{cls:"kt-detail"},el("h2",{textContent:"Сравнение версий"}),
       el("p",{textContent:"История установок отображается отдельно. Совпадение коммитов или названий без исторического манифеста не доказывает различия способностей."})));
     status.textContent="Сравнение по проверенным манифестам";return;
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
   if(mode==="architecture"||mode==="connections") graph.append(buildGraph(nodes,selected,id=>{selected=id;render();},graphZoom));
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
   render();
 }).catch(()=>{ /* Older server: use built-in verified catalog. */ });
 void Promise.all([api.updateStatus(),api.updateHistory()]).then(([st,h])=>{
   releases=evolutionFromUpdater(st.ok?st.value:null,h.ok?h.value:null);
   updatesLoading=false;
   render();
 }).catch(()=>{updatesLoading=false;render();});
 render();return root;
}
