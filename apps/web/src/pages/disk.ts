/** Personal JUUNIBI Disk: a compact owner-facing file explorer. */
import {api,type DiskFile} from "../api";
import {el,icon} from "../dom";
import {showToast} from "../toast";
import {diskIcon} from "./disk-icons";

const human=(b:number)=>b<1024?b+" Б":b<1048576?(b/1024).toFixed(1)+" КБ":(b/1048576).toFixed(1)+" МБ";
const button=(label:string,fn:()=>void)=>{const b=el("button",{type:"button",cls:"mem-btn",textContent:label});b.addEventListener("click",fn);return b;};
export function diskPage():HTMLElement {
  const page=el("div",{cls:"pg disk-page"});
  const status=el("p",{cls:"muted small disk-status-line",textContent:"Загрузка сведений о локальном хранилище…",attrs:{"aria-live":"polite"}});
  const heroTitle=el("strong",{textContent:"Твоё цифровое пространство"});
  const fileCount=el("strong",{textContent:"—"}),storage=el("strong",{textContent:"—"}),trashCount=el("strong",{textContent:"—"});
  const tiles=el("div",{cls:"disk-summary"},...[
    ["Файлы",fileCount,diskIcon("vault")],["Хранение",storage,diskIcon("constellation")],["В корзине",trashCount,diskIcon("archive")]
  ].map(([label,value,glyph])=>el("div",{cls:"disk-summary-cell"},glyph as SVGSVGElement,
    el("span",{cls:"disk-summary-number"},value as HTMLElement),el("span",{cls:"disk-summary-label",textContent:label as string}))));
  const hero=el("section",{cls:"disk-hero",attrs:{"aria-label":"Обзор хранилища"}},
    el("div",{cls:"disk-hero-intro"},el("small",{textContent:"JUUNIBI  /  ЛИЧНЫЙ АРХИВ"}),
      el("h2",{},heroTitle),el("p",{textContent:"Файлы и воспоминания — спокойно, удобно, под контролем."})),
    tiles);

  /** Only animate changes in an existing number: never introduce fake interim values. */
  const updateStat=(node:HTMLElement,value:string)=>{
    if(node.textContent===value)return;
    node.textContent=value;
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    node.animate([{opacity:.35,transform:"translateY(5px)"},{opacity:1,transform:"translateY(0)"}],{duration:240,easing:"cubic-bezier(.2,.7,.2,1)"});
  };
  const folders=el("div",{cls:"disk-folders"});
  const files=el("div",{cls:"disk-files"});
  const tree=el("nav",{cls:"disk-tree",attrs:{"aria-label":"Дерево папок"}});
  const treeExpanded=new Set<string>([""]);
  let folderStyles:Record<string,{color:string;pinned:boolean;cover:string;createdAt?:string}>={};
  let folderSort:"name"|"files"|"size"|"pinned"|"created"="pinned";
  let virtualFilter:"none"|"images"|"documents"|"large"|"recent"="none";
  let folderQuery="";
  let treeHidden=false;
  const details=el("aside",{cls:"disk-file-details",attrs:{"aria-label":"Сведения о файле"}});
  const search=el("input",{type:"search",cls:"mem-input",placeholder:"Поиск файлов",attrs:{"aria-label":"Поиск файлов"}});
  const searchContents=el("input",{type:"checkbox",attrs:{"aria-label":"Искать внутри текстовых файлов"}});
  const upload=el("input",{type:"file",multiple:true,attrs:{"aria-label":"Выбрать файлы для загрузки"}});
  const newFolder=el("input",{type:"text",cls:"mem-input",maxLength:80,placeholder:"Новая папка",attrs:{"aria-label":"Название новой папки"}});
  let current="",items:DiskFile[]=[],trash:DiskFile[]=[],allFolders:string[]=[],treeFiles:DiskFile[]=[];
  let visibleLimit=100;
  let contentIds:Set<string>|null=null;
  let viewFilter:"all"|"favorites"|"trash"="all";
  let gridMode=localStorage.getItem("juunibi.disk.grid")!=="false";
  const selected=new Set<string>();
  let lastSelectedId:string|null=null;
  let clipboard:{ids:string[];cut:boolean}|null=null;
  let extensionFilter="";
  let groupBy:"none"|"type"|"date"="none";
  const thumbnailUrls=new Map<string,string>();
  const pendingThumbnails=new Set<string>();
  let thumbnailGeneration=0;
  const MAX_THUMBNAILS=24;
  const cleanupThumbnails=()=>{for(const url of thumbnailUrls.values())URL.revokeObjectURL(url);thumbnailUrls.clear();};
  const observer=new MutationObserver(()=>{if(!page.isConnected){thumbnailGeneration++;cleanupThumbnails();observer.disconnect();}});
  observer.observe(document.body,{childList:true,subtree:true});
  const bulkBar=el("div",{cls:"disk-bulk-bar"});
  let firstPaint=true;
  const setBusy=(busy:boolean)=>{drop.classList.toggle("disk-is-busy",busy);drop.setAttribute("aria-busy",String(busy));};
  const allFiles=()=>viewFilter==="trash"?trash:items.filter(f=>(viewFilter!=="favorites"||f.favorite)&&(virtualFilter==="none"||virtualFilter==="recent"&&Date.now()-new Date(f.uploadedAt).getTime()<7*86400000||virtualFilter==="large"&&f.size>5*1024*1024||virtualFilter==="images"&&/\\.(png|jpe?g|webp|gif)$/i.test(f.name)||virtualFilter==="documents"&&/\\.(pdf|docx?|xlsx?|txt|md)$/i.test(f.name)));
  /** Animate only after a successful mutation; reduced-motion skips the transition. */
  const exitFile=async(id:string)=>{
    const node=[...files.querySelectorAll<HTMLElement>(".disk-file")].find(card=>card.dataset.fileId===id);
    if(!node||!page.isConnected||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    try{
      await node.animate([{opacity:1,transform:"translateX(0) scale(1)"},{opacity:0,transform:"translateX(16px) scale(.96)"}],
        {duration:190,easing:"cubic-bezier(.3,0,.7,1)",fill:"forwards"}).finished;
    }catch{/* Page was removed or animation cancelled: proceed with the update. */}
  };
  const renderBulk=()=>{
    const count=selected.size;
    bulkBar.hidden=!count;
    if(!count){bulkBar.replaceChildren();return;}
    const action=(label:string,type:"trash"|"restore"|"move"|"favorite"|"unfavorite")=>button(label,async()=>{
      if(type==="trash"&&!confirm("В корзину: "+count+" файлов?"))return;
      let folder:string|undefined;
      if(type==="move"){const name=prompt("Папка назначения: "+["Главная",...allFolders].join(", ")+". Пустое поле — главная.","");if(name===null)return;folder=name.trim();}
      const r=await api.diskBulk([...selected],type,folder);
      if(!r.ok){showToast(r.error.message);return;}
      selected.clear();status.textContent="Изменено файлов: "+r.value.updated;void refresh();
    });
    bulkBar.replaceChildren(el("strong",{textContent:"Выбрано: "+count}),
      ...(viewFilter==="trash"?[action("Восстановить","restore")]:[
        action("★ Избранное","favorite"),action("Переместить","move"),action("В корзину","trash")]),
      button("Снять выбор",()=>{selected.clear();renderFiles();}));
  };
  const thumbnails=async(entries:DiskFile[])=>{
    const generation=++thumbnailGeneration;
    const candidates=entries.filter(f=>/\.(png|jpe?g|webp|gif)$/i.test(f.name)).slice(0,12);
    for(const f of candidates){
      if(generation!==thumbnailGeneration||!page.isConnected)return;
      if(thumbnailUrls.has(f.id)){const img=files.querySelector<HTMLImageElement>('img[data-disk-id="'+f.id+'"]');if(img){img.src=thumbnailUrls.get(f.id)!;img.classList.add("disk-thumbnail-loaded");}continue;}
      if(pendingThumbnails.has(f.id))continue;
      pendingThumbnails.add(f.id);
      try{
        const r=await api.diskGet(f.id);
        if(!r.ok||generation!==thumbnailGeneration||!page.isConnected)return;
        const bytes=Uint8Array.from(atob(r.value.base64),c=>c.charCodeAt(0));
        const ext=f.name.split(".").pop()!.toLowerCase();
        const mime=ext==="png"?"image/png":ext==="webp"?"image/webp":ext==="gif"?"image/gif":"image/jpeg";
        const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
        if(thumbnailUrls.size>=MAX_THUMBNAILS){const first=thumbnailUrls.keys().next().value;if(first){URL.revokeObjectURL(thumbnailUrls.get(first)!);thumbnailUrls.delete(first);}}
        thumbnailUrls.set(f.id,url);
        const img=files.querySelector<HTMLImageElement>('img[data-disk-id="'+f.id+'"]');
        if(img){img.src=url;img.classList.add("disk-thumbnail-loaded");}
      }finally{pendingThumbnails.delete(f.id);}
    }
  };
  const allSearch=el("input",{type:"checkbox",attrs:{"aria-label":"Искать по всем папкам"}});
  allSearch.addEventListener("change",()=>{selected.clear();void refresh();});

  const viewButton=button("Вид: плитка",()=>{gridMode=!gridMode;localStorage.setItem("juunibi.disk.grid",String(gridMode));renderFiles();});
  const sortSelect=el("select",{cls:"mem-select",attrs:{"aria-label":"Сортировать файлы"}},el("option",{value:"new",textContent:"Сначала новые"}),el("option",{value:"name",textContent:"По имени"}),el("option",{value:"size",textContent:"По размеру"}));
  sortSelect.addEventListener("change",()=>renderFiles());
  const breadcrumb=el("span",{cls:"muted small"});
  const drop=el("div",{cls:"disk-drop"},icon("folder",24),el("strong",{textContent:"Перетащи файлы сюда"}),el("span",{cls:"muted small",textContent:"До 50 МБ на файл"}));
  const statistics=el("dialog",{cls:"disk-preview disk-chronicles"});
  const openStatistics=async()=>{
    const response=await api.diskChronicles();
    if(!response.ok){showToast(response.error.message);return;}
    const data=response.value;
    const toolbar=el("div",{cls:"disk-preview-head disk-chronicles-heading"},diskIcon("constellation"),el("strong",{textContent:"Хроники Диска · 100 показателей"}),button("Закрыть",()=>statistics.close()));
    const summary=el("div",{cls:"disk-chronicles-hero"},el("span",{cls:"disk-chronicles-orbit",textContent:"✦"}),el("div",{},el("small",{textContent:"ЛИЧНАЯ ВСЕЛЕННАЯ ФАЙЛОВ"}),el("strong",{textContent:data.summary.total+" показателей"}),el("span",{textContent:"Подтверждено: "+data.summary.ready+" · Ожидают данных: "+(data.summary.total-data.summary.ready)})));
    const q=el("input",{type:"search",placeholder:"Поиск показателя",cls:"mem-input",attrs:{"aria-label":"Поиск показателя"}});
    const content=el("div",{cls:"disk-stats-groups"});
    const sections=data.groups.map((g,i)=>({
      group:g,metrics:data.metrics.slice(i*9,i===10?100:(i+1)*9)
    }));
    const render=()=>{
      const text=q.value.toLocaleLowerCase().trim();
      const nodes=sections.flatMap(({group,metrics})=>{
        const found=metrics.filter(m=>!text||m.title.toLocaleLowerCase().includes(text));
        if(!found.length)return [];
        const section=el("details",{cls:"disk-stats-group",open:!!text});
        section.append(el("summary",{textContent:group.title+" · "+found.length}));
        const tiles=el("div",{cls:"disk-stats-tiles"});
        const draw=()=>{
          if(tiles.childElementCount)return;
          tiles.append(...found.map(m=>el("div",{cls:"disk-stats-tile"+(m.ready?" is-ready":" is-pending")},
            el("small",{cls:"muted",textContent:m.id.slice(1)+" · "+m.title}),
            el("strong",{textContent:m.value}),
            el("small",{cls:"disk-metric-status",textContent:m.ready?"● Рассчитано по данным Диска":"◌ Нет данных"}))));
        };
        section.addEventListener("toggle",()=>{if(section.open)draw();});
        if(text)draw();
        section.append(tiles);
        return [section];
      });
      content.replaceChildren(...nodes);
    };
    q.addEventListener("input",render);render();
    statistics.replaceChildren(toolbar,summary,q,content);
    statistics.showModal();
    statistics.classList.add("disk-dialog-enter");
    statistics.addEventListener("animationend",()=>statistics.classList.remove("disk-dialog-enter"),{once:true});
  };
  const toolsDialog=el("dialog",{cls:"disk-preview disk-audit-panel"});
  const openDiskTools=async()=>{
    const [audit,duplicates]=await Promise.all([api.diskAudit(),api.diskDuplicates()]);
    if(!audit.ok||!duplicates.ok){showToast("Диагностика Диска недоступна");return;}
    const failures=audit.value.results.filter(x=>x.status!=="ok");
    const output=el("div",{cls:"disk-tool-report"},
      el("strong",{textContent:"Файлов проверено: "+audit.value.total+" · Исправных: "+audit.value.ok}),
      el("p",{textContent:failures.length?"Проблемы: "+failures.map(x=>x.name+" ("+x.status+")").join("; "):"Повреждённых и отсутствующих файлов не обнаружено"}),
      el("strong",{textContent:"Исторических редакций проверено: "+(audit.value.revisionsChecked??0)}),
      el("p",{textContent:audit.value.revisionIssues?.length?"Проблемы с версиями: "+audit.value.revisionIssues.map(v=>v.fileId.slice(0,8)+" · редакция "+v.revision+" ("+v.status+")").join("; "):"Архивные редакции без ошибок"}),
      el("strong",{textContent:"Группы одинаковых файлов: "+duplicates.value.groups.length}),
      ...duplicates.value.groups.map(g=>el("p",{textContent:g.map(x=>x.name).join(" / ")}))
    );
    toolsDialog.replaceChildren(el("div",{cls:"disk-preview-head"},el("strong",{textContent:"Проверка и дубликаты"}),button("Закрыть",()=>toolsDialog.close())),output);
    toolsDialog.showModal();
  };
  const toolsButton=button("Проверка файлов",()=>void openDiskTools());
  const backupButton=button("Резервная копия файлов",()=>{
    const link=document.createElement("a");
    link.href="/api/disk/backup";link.download="JUUNIBI-backup.ndjson";
    document.body.append(link);link.click();link.remove();
    status.textContent="Загрузка полного архива с файлами и предыдущими версиями. Сохраните его на другом носителе.";
  });
  const restoreInput=el("input",{type:"file",accept:".ndjson,.jsonl",attrs:{"aria-label":"Выбрать резервный архив JUUNIBI"}});
  restoreInput.hidden=true;
  restoreInput.addEventListener("change",async()=>{
    const file=restoreInput.files?.[0];if(!file)return;
    restoreInput.value="";
    if(!confirm("Восстановление разрешено только на пустом Диске. Данные архива будут проверены по SHA-256. Продолжить?"))return;
    status.textContent="Проверка и восстановление файлов из архива…";
    try{
      const response=await fetch("/api/disk/backup/restore",{method:"POST",headers:{"Content-Type":"application/x-ndjson"},body:file});
      const result=await response.json() as {files?:number;error?:string};
      if(!response.ok)throw new Error(result.error??"Восстановление невозможно");
      status.textContent="Восстановлено файлов: "+result.files;void refresh();
    }catch(e){showToast(e instanceof Error?e.message:"Ошибка восстановления");}
  });
  const restoreBackupButton=button("Восстановить из копии",()=>restoreInput.click());
  page.append(restoreInput);
  const exportButton=button("Экспорт каталога",async()=>{
    const r=await api.diskSnapshot();if(!r.ok){showToast(r.error.message);return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(r.value,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="JUUNIBI-disk-catalog.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
  page.append(toolsDialog);
  const extension=el("input",{type:"text",cls:"mem-input",placeholder:"Расширение (pdf, txt…)",maxLength:12,attrs:{"aria-label":"Фильтр по расширению"}});
  extension.addEventListener("input",()=>{extensionFilter=extension.value.trim().replace(/^\./,"").toLowerCase();visibleLimit=100;renderFiles();});
  const grouping=el("select",{cls:"mem-select",attrs:{"aria-label":"Группировка файлов"}},el("option",{value:"none",textContent:"Обычный список"}),el("option",{value:"type",textContent:"По типу"}),el("option",{value:"date",textContent:"По месяцу"}));
  grouping.addEventListener("change",()=>{groupBy=grouping.value as typeof groupBy;renderFiles();});
  const clipboardButton=button("Копировать выбранное",()=>{if(!selected.size)return;clipboard={ids:[...selected],cut:false};status.textContent="Файлов в буфере: "+clipboard.ids.length;});
  const cutButton=button("Вырезать выбранное",()=>{if(!selected.size)return;clipboard={ids:[...selected],cut:true};status.textContent="Вырезано файлов: "+clipboard.ids.length;});
  const pasteButton=button("Вставить",async()=>{
    if(!clipboard)return;
    const destination=await pickDestination();if(destination===null)return;
    if(clipboard.cut){const r=await api.diskBulk(clipboard.ids,"move",destination);if(!r.ok){showToast(r.error.message);return;}}
    else for(const id of clipboard.ids){const r=await api.diskCopy(id,destination);if(!r.ok){showToast(r.error.message);return;}}
    clipboard=null;void refresh();
  });
  const undoButton=button("Отменить действие",async()=>{const r=await api.diskUndo();if(!r.ok)showToast(r.error.message);else void refresh();});
  const historyButton=button("История действий",async()=>{
    const r=await api.diskFileHistory();if(!r.ok){showToast(r.error.message);return;}
    const d=el("dialog",{cls:"disk-preview"});
    d.append(el("h3",{textContent:"История файлов"}),...r.value.actions.slice(0,50).map(a=>el("p",{textContent:a.before.name+" · "+a.before.folder+" → "+a.after.folder+" · "+new Date(a.at).toLocaleString("ru-RU")})),button("Закрыть",()=>d.close()));
    d.addEventListener("close",()=>d.remove(),{once:true});page.append(d);d.showModal();
  });
  page.addEventListener("keydown",e=>{
    const target=e.target;
    if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement||target instanceof HTMLElement&&target.isContentEditable)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="c"&&selected.size){e.preventDefault();clipboard={ids:[...selected],cut:false};status.textContent="Скопировано файлов: "+selected.size;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="x"&&selected.size){e.preventDefault();clipboard={ids:[...selected],cut:true};status.textContent="Вырезано файлов: "+selected.size;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="v"&&clipboard){e.preventDefault();pasteButton.click();}
  });
  const statsButton=button("Хроники Диска",()=>void openStatistics());
  statsButton.prepend(diskIcon("constellation"));statsButton.classList.add("disk-chronicles-button");
  page.append(statistics);
  const preview=el("dialog",{cls:"disk-preview"});
  const openPreview=async(f:DiskFile)=>{
    const r=await api.diskGet(f.id);
    if(!r.ok){showToast(r.error.message);return;}
    const binary=atob(r.value.base64);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const ext=f.name.split(".").pop()?.toLowerCase()??"";
    const isImage=["png","jpg","jpeg","webp","gif"].includes(ext);
    const isPdf=ext==="pdf";
    const isText=["txt","md","csv","json","log"].includes(ext);
    const mime=isPdf?"application/pdf":({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif"} as Record<string,string>)[ext]??"application/octet-stream";
    const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
    const content=isImage?el("img",{src:url,alt:f.name,cls:"disk-preview-image"}):
      isPdf?el("iframe",{src:url,cls:"disk-preview-document",title:f.name}):
      isText?el("pre",{cls:"disk-preview-text",textContent:new TextDecoder().decode(bytes)}):
      el("p",{cls:"muted",textContent:"Для этого формата предварительный просмотр пока недоступен. Файл можно скачать."});
    const close=()=>{preview.close();URL.revokeObjectURL(url);};
    preview.replaceChildren(el("div",{cls:"disk-preview-head"},el("strong",{textContent:f.name}),button("Закрыть",close)),content,
      el("p",{cls:"muted small",textContent:human(f.size)+" · "+new Date(f.uploadedAt).toLocaleString("ru-RU")}));
    preview.showModal();
    preview.addEventListener("close",()=>URL.revokeObjectURL(url),{once:true});
  };
  page.append(preview);
  const renderFiles=()=>{
    thumbnailGeneration++;
    const q=search.value.trim().toLocaleLowerCase();
    const shown=allFiles().filter(f=>(!extensionFilter||f.name.toLowerCase().endsWith("."+extensionFilter))&&(!q||f.name.toLocaleLowerCase().includes(q)||(contentIds?.has(f.id)??false))).sort((a,b)=>sortSelect.value==="name"?a.name.localeCompare(b.name,"ru"):sortSelect.value==="size"?b.size-a.size:b.uploadedAt.localeCompare(a.uploadedAt));
    files.classList.toggle("disk-grid",gridMode);
    files.classList.toggle("disk-list",!gridMode);
    viewButton.textContent=gridMode?"Вид: плитка":"Вид: список";
    const visible=shown.slice(0,visibleLimit);
    files.replaceChildren(...(visible.length?visible.map((f,index)=>{
      const name=el("strong",{textContent:f.name});
      if(f.tags?.length)name.title="Метки: "+f.tags.join(", ");
      const card=el("div",{cls:"disk-file"+(firstPaint&&index<16?" disk-reveal":"")});
      card.draggable=viewFilter!=="trash";
      card.addEventListener("dragstart",e=>{e.dataTransfer?.setData("application/x-juunibi-file",f.id);});
      card.dataset.fileId=f.id;
      if(firstPaint&&index<16)card.style.setProperty("--disk-order",String(index));
      const choose=el("input",{type:"checkbox",checked:selected.has(f.id),attrs:{"aria-label":"Выбрать "+f.name}});
      choose.addEventListener("click",e=>{
        if(e.shiftKey&&lastSelectedId){
          const start=visible.findIndex(x=>x.id===lastSelectedId);
          const end=visible.findIndex(x=>x.id===f.id);
          if(start>=0&&end>=0)for(const file of visible.slice(Math.min(start,end),Math.max(start,end)+1))selected.add(file.id);
          renderFiles();
        }
        lastSelectedId=f.id;
      });
      choose.addEventListener("change",()=>{if(choose.checked)selected.add(f.id);else selected.delete(f.id);card.classList.toggle("disk-selected",choose.checked);renderBulk();});
      card.classList.toggle("disk-selected",selected.has(f.id));
      const ext=f.name.split(".").pop()?.toLowerCase()??"";
      const fileGlyph=/^(png|jpg|jpeg|gif|webp|svg)$/.test(ext)?"image":/^(pdf|doc|docx|txt|md|rtf)$/.test(ext)?"file-text":/^(ts|tsx|js|jsx|mjs|py|json|html|css)$/.test(ext)?"file-code":/^(zip|7z|rar|tar|gz)$/.test(ext)?"archive":"file";
      const thumbnail=el("span",{cls:"disk-file-icon"},icon(fileGlyph,22));
      if(f.color)thumbnail.style.color=f.color;
      if(/\.(png|jpe?g|webp|gif)$/i.test(f.name) && viewFilter!=="trash"){
        const img=el("img",{cls:"disk-thumbnail",alt:"",attrs:{"data-disk-id":f.id}});
        const url=thumbnailUrls.get(f.id);if(url){img.src=url;img.classList.add("disk-thumbnail-loaded");}
        thumbnail.replaceChildren(img);
      }
      const actions=el("details",{cls:"disk-actions"});
      const summary=el("summary",{textContent:"⋯",attrs:{"aria-label":"Действия с файлом "+f.name}});
      const download=button("Скачать",async()=>{
        actions.open=false;
        const r=await api.diskGet(f.id);
        if(!r.ok){showToast(r.error.message);return;}
        const bytes=Uint8Array.from(atob(r.value.base64),c=>c.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes]));
        const link=document.createElement("a");link.href=url;link.download=f.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      });
      const del=button("Удалить",async()=>{
        actions.open=false;
        if(!confirm("Переместить файл «"+f.name+"» в корзину?"))return;
        const r=await api.diskDelete(f.id);
        if(!r.ok)showToast(r.error.message);else {await exitFile(f.id);void refresh();}
      });
      const show=button("Просмотр",()=>{actions.open=false;void openPreview(f);});
      const rename=button("Переименовать",async()=>{
        actions.open=false;
        const name=prompt("Новое название файла",f.name);
        if(name===null||name.trim()===f.name)return;
        const r=await api.diskRename(f.id,name.trim());
        if(!r.ok)showToast(r.error.message);else void refresh();
      });
      const copy=button("Копировать в папку",async()=>{actions.open=false;const folder=await pickDestination();if(folder===null)return;const r=await api.diskCopy(f.id,folder);if(!r.ok)showToast(r.error.message);else void refresh();});
      const revisions=button("История версий",async()=>{
        actions.open=false;
        const r=await api.diskVersions(f.id);if(!r.ok){showToast(r.error.message);return;}
        const dialog=el("dialog",{cls:"disk-preview disk-versions-dialog"});
        const message=el("p",{cls:"muted small",attrs:{"aria-live":"polite"}});
        const uploader=el("input",{type:"file",attrs:{"aria-label":"Файл новой редакции"}});
        const save=button("Загрузить новую редакцию",async()=>{
          const file=uploader.files?.[0];if(!file){message.textContent="Выберите файл";return;}
          if(!file.size||file.size>50*1024*1024){message.textContent="Разрешено от 1 байта до 50 МБ";return;}
          save.disabled=true;message.textContent="Сохранение новой редакции…";
          try{
            const res=await fetch("/api/disk/files/"+encodeURIComponent(f.id)+"/versions/binary?expected="+encodeURIComponent(f.sha256),
              {method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});
            if(!res.ok){const error=await res.json() as {error?:string};throw new Error(error.error??"Ошибка сохранения");}
            dialog.close();void refresh();
          }catch(e){message.textContent=e instanceof Error?e.message:"Ошибка сохранения";}
          finally{save.disabled=false;}
        });
        const history=r.value.versions.slice().reverse().map(v=>el("div",{cls:"disk-tree-recovery"},
          el("span",{textContent:"Редакция "+v.revision+" · "+human(v.size)+" · "+new Date(v.at).toLocaleString("ru-RU")}),
          v.revision===(f.revision??1)?
            el("small",{textContent:"Текущая"}):
            button("Восстановить",async()=>{
              if(!confirm("Восстановить редакцию "+v.revision+" файла «"+f.name+"»? Текущая редакция сохранится в истории."))return;
              const result=await api.diskRestoreVersion(f.id,v.revision);
              if(!result.ok){message.textContent=result.error.message;return;}
              dialog.close();void refresh();
            })));
        dialog.append(el("div",{cls:"disk-preview-head"},el("strong",{textContent:"Версии · "+f.name}),button("Закрыть",()=>dialog.close())),
          ...history,el("hr"),el("p",{textContent:"Новая редакция"}),uploader,save,message);
        dialog.addEventListener("close",()=>dialog.remove(),{once:true});page.append(dialog);dialog.showModal();
      });
      const favorite=button(f.favorite?"★ Убрать из избранного":"☆ В избранное",async()=>{
        actions.open=false;const r=await api.diskFavorite(f.id,!f.favorite);
        if(!r.ok)showToast(r.error.message);else void refresh();
      });
      const move=button("Переместить в папку",async()=>{
        actions.open=false;
        const folder=await pickDestination();
        if(folder===null)return;
        const r=await api.diskMove(f.id,folder);
        if(!r.ok)showToast(r.error.message);else {await exitFile(f.id);void refresh();}
      });
      const restore=button("Восстановить",async()=>{actions.open=false;const r=await api.diskRestore(f.id);if(!r.ok)showToast(r.error.message);else {await exitFile(f.id);void refresh();}});
      const purge=button("Удалить навсегда",async()=>{
        actions.open=false;if(!confirm("Безвозвратно удалить «"+f.name+"»?"))return;
        const r=await api.diskPurge(f.id);if(!r.ok)showToast(r.error.message);else void refresh();
      });
      actions.append(summary,el("div",{cls:"disk-actions-menu"},...(viewFilter==="trash"?[restore,purge]:[show,revisions,favorite,copy,move,rename,download,del])));
      const open=button(viewFilter==="trash"?"В корзине":"Открыть",()=>{if(viewFilter!=="trash")void openPreview(f);});
      open.disabled=viewFilter==="trash";
      const info=button("Сведения",()=>{details.replaceChildren(el("strong",{textContent:f.name}),el("p",{textContent:"Размер: "+human(f.size)}),el("p",{textContent:"Папка: "+(f.folder||"Главная")}),el("p",{textContent:"Загружен: "+new Date(f.uploadedAt).toLocaleString("ru-RU")}),el("small",{textContent:"SHA-256: "+f.sha256}));});
      const editMeta=button("Метки и цвет",()=>{
        const dialog=el("dialog",{cls:"disk-preview"});
        const tags=el("input",{type:"text",cls:"mem-input",value:(f.tags??[]).join(", "),placeholder:"Метки через запятую"});
        const color=el("input",{type:"color",value:f.color??"#c6a76a"});
        const note=el("textarea",{cls:"mem-input",value:f.note??"",placeholder:"Описание файла"});
        const message=el("p",{cls:"muted small"});
        const save=button("Сохранить",async()=>{
          const r=await api.diskMetadata(f.id,tags.value.split(",").map(x=>x.trim()).filter(Boolean),color.value,note.value);
          if(!r.ok){message.textContent=r.error.message;return;}
          dialog.close();dialog.remove();void refresh();
        });
        dialog.append(el("h3",{textContent:"Метки и оформление · "+f.name}),tags,color,note,message,
          el("div",{cls:"disk-preview-head"},save,button("Отмена",()=>dialog.close())));
        dialog.addEventListener("close",()=>dialog.remove(),{once:true});page.append(dialog);dialog.showModal();
      });
      actions.querySelector(".disk-actions-menu")?.append(editMeta,info);
      card.append(choose,thumbnail,el("div",{cls:"disk-file-info"},name,el("small",{cls:"muted",textContent:human(f.size)+" · "+new Date(f.uploadedAt).toLocaleDateString("ru-RU")})),open,actions);
      return card;
    }):[el("p",{cls:"muted",textContent:q?"Ничего не найдено":"Здесь пока нет файлов."})]));
    if(groupBy!=="none"&&visible.length){
      let previous="";
      for(const card of [...files.querySelectorAll<HTMLElement>(".disk-file")]){
        const f=visible.find(item=>item.id===card.dataset.fileId);
        if(!f)continue;
        const key=groupBy==="type"?(f.name.split(".").pop()?.toUpperCase()??"Другое"):f.uploadedAt.slice(0,7);
        if(previous!==key){card.before(el("div",{cls:"disk-group-heading",textContent:key}));previous=key;}
      }
    }
    if(shown.length>visible.length)files.append(button("Показать ещё ("+(shown.length-visible.length)+")",()=>{visibleLimit+=100;renderFiles();}));
    renderBulk();
    firstPaint=false;
    if(gridMode&&viewFilter!=="trash")void thumbnails(visible);
  };
  const pickDestination=(movingFolder?:string):Promise<string|null>=>new Promise(resolve=>{
    const dialog=el("dialog",{cls:"disk-preview disk-destination-dialog"});
    const searchInput=el("input",{type:"search",cls:"mem-input",placeholder:"Найти папку назначения"});
    const list=el("div",{cls:"disk-destination-list"});
    let chosen=movingFolder?movingFolder.includes("/")?movingFolder.slice(0,movingFolder.lastIndexOf("/")):"":current;
    const summary=el("p",{cls:"muted small"});
    const draw=()=>{
      const query=searchInput.value.trim().toLocaleLowerCase();
      const candidates=["",...allFolders].filter(folder=>(!movingFolder||folder!==movingFolder&&!folder.startsWith(movingFolder+"/"))&&(!query||folder.toLocaleLowerCase().includes(query)||!folder));
      list.replaceChildren(...candidates.map(folder=>{
        const control=button((folder?"📁 "+folder:"⌂ Корень диска")+(chosen===folder?" ✓":""),()=>{chosen=folder;draw();});
        control.classList.add("disk-destination-item");
        if(chosen===folder)control.classList.add("selected");
        return control;
      }));
      summary.textContent="Назначение: "+(chosen||"Корень диска");
    };
    let finished=false;
    const close=(value:string|null)=>{if(finished)return;finished=true;dialog.close();resolve(value);};
    searchInput.addEventListener("input",draw);
    dialog.append(el("div",{cls:"disk-preview-head"},el("strong",{textContent:"Выбрать папку назначения"}),button("Закрыть",()=>close(null))),searchInput,list,summary,
      el("div",{cls:"disk-preview-head"},button("Переместить сюда",()=>close(chosen)),button("Отмена",()=>close(null))));
    dialog.addEventListener("close",()=>{dialog.remove();if(!finished){finished=true;resolve(null);}},{once:true});
    page.append(dialog);draw();dialog.showModal();
  });
  const renderTree=()=>{
    const counts=new Map<string,number>();
    const bytes=new Map<string,number>();
    for(const file of treeFiles){
      let p=file.folder;
      counts.set("",(counts.get("")??0)+1);bytes.set("",(bytes.get("")??0)+file.size);
      while(p){counts.set(p,(counts.get(p)??0)+1);bytes.set(p,(bytes.get(p)??0)+file.size);p=p.includes("/")?p.slice(0,p.lastIndexOf("/")):"";}
    }
    const children=new Map<string,string[]>();
    for(const full of allFolders){
      const parent=full.includes("/")?full.slice(0,full.lastIndexOf("/")):"";
      const list=children.get(parent)??[];list.push(full);children.set(parent,list);
    }
    for(const list of children.values())list.sort((a,b)=>folderSort==="files"?(counts.get(b)??0)-(counts.get(a)??0):folderSort==="size"?(bytes.get(b)??0)-(bytes.get(a)??0):folderSort==="created"?(folderStyles[b]?.createdAt??"").localeCompare(folderStyles[a]?.createdAt??""):folderSort==="pinned"?Number(!!folderStyles[b]?.pinned)-Number(!!folderStyles[a]?.pinned)||a.localeCompare(b,"ru"):a.localeCompare(b,"ru"));
    const openFolder=(folder:string)=>{
      current=folder;viewFilter="all";virtualFilter="none";allSearch.checked=false;selected.clear();visibleLimit=100;
      for(let p=folder;p.includes("/");p=p.slice(0,p.lastIndexOf("/")))treeExpanded.add(p.slice(0,p.lastIndexOf("/")));
      void refresh();
    };
    const draw=(folder:string,depth:number):HTMLElement=>{
      const label=folder?folder.split("/").pop()!:"Все файлы";
      const descendants=children.get(folder)??[];
      const expandable=descendants.length>0;
      const expanded=treeExpanded.has(folder);
      const node=el("div",{cls:"disk-tree-node"});
      const line=el("div",{cls:"disk-tree-line"+(current===folder&&viewFilter==="all"?" is-current":"")});
      const toggle=el("button",{type:"button",cls:"disk-tree-toggle",textContent:expandable?(expanded?"▾":"▸"):"·",attrs:{"aria-label":expanded?"Свернуть "+label:"Развернуть "+label,"aria-expanded":String(expanded)}});
      toggle.disabled=!expandable;
      toggle.addEventListener("click",()=>{if(treeExpanded.has(folder))treeExpanded.delete(folder);else treeExpanded.add(folder);renderTree();});
      const select=el("button",{type:"button",cls:"disk-tree-select",attrs:{"aria-current":current===folder&&viewFilter==="all"?"page":"false"}},icon(expanded?"folder-open":"folder",16),el("span",{textContent:(folderStyles[folder]?.pinned?"★ ":"")+label}),el("small",{textContent:String(counts.get(folder)??0)}));
      if(folderStyles[folder]?.color)select.style.color=folderStyles[folder]!.color;
      const coverId=folderStyles[folder]?.cover;
      if(coverId){
        const pic=el("img",{cls:"disk-tree-cover",alt:""});
        const cached=thumbnailUrls.get(coverId);
        if(cached)pic.src=cached;
        else void (async()=>{
          if(pendingThumbnails.has(coverId))return;
          pendingThumbnails.add(coverId);
          const r=await api.diskGet(coverId);
          pendingThumbnails.delete(coverId);
          if(!r.ok||!page.isConnected)return;
          const bytes=Uint8Array.from(atob(r.value.base64),c=>c.charCodeAt(0));
          const coverName=treeFiles.find(x=>x.id===coverId)?.name??"";
          const coverMime=/\\.png$/i.test(coverName)?"image/png":/\\.webp$/i.test(coverName)?"image/webp":/\\.gif$/i.test(coverName)?"image/gif":"image/jpeg";
          const url=URL.createObjectURL(new Blob([bytes],{type:coverMime}));
          if(thumbnailUrls.size>=MAX_THUMBNAILS){const old=thumbnailUrls.keys().next().value;if(old){URL.revokeObjectURL(thumbnailUrls.get(old)!);thumbnailUrls.delete(old);}}
          thumbnailUrls.set(coverId,url);pic.src=url;
        })();
        select.prepend(pic);
      }
      select.addEventListener("click",()=>openFolder(folder));
      select.addEventListener("keydown",e=>{
        if(e.key==="ArrowDown"||e.key==="ArrowUp"){
          e.preventDefault();const buttons=[...tree.querySelectorAll<HTMLButtonElement>(".disk-tree-select")];
          const n=buttons.indexOf(select)+(e.key==="ArrowDown"?1:-1);buttons[Math.max(0,Math.min(buttons.length-1,n))]?.focus();
        }
        if(e.key==="Enter"){e.preventDefault();openFolder(folder);}
        if(e.key==="ArrowRight"){e.preventDefault();treeExpanded.add(folder);renderTree();}
        if(e.key==="ArrowLeft"){e.preventDefault();treeExpanded.delete(folder);renderTree();}
        if(e.key==="F2"&&folder){e.preventDefault();const menu=line.querySelector<HTMLDetailsElement>(".disk-folder-actions");if(menu){menu.open=true;menu.querySelector<HTMLInputElement>("input")?.focus();}}
      });
      if(folder){
        const menu=el("details",{cls:"disk-folder-actions"});
        const summary=el("summary",{cls:"disk-folder-menu",textContent:"⋯",attrs:{"aria-label":"Действия с папкой "+label}});
        const controls=el("div",{cls:"disk-folder-popover"});
        const field=el("input",{type:"text",cls:"mem-input",maxLength:80,placeholder:"Имя папки",attrs:{"aria-label":"Имя папки"}});
        const feedback=el("small",{cls:"disk-folder-feedback",attrs:{"aria-live":"polite"}});
        const submit=button("Создать подпапку",async()=>{
          const name=field.value.trim();if(!name)return;
          const r=await api.diskFolder(folder+"/"+name);
          if(!r.ok){feedback.textContent=r.error.message;return;}
          treeExpanded.add(folder);menu.open=false;void refresh();
        });
        const rename=button("Переименовать",async()=>{
          const name=field.value.trim();if(!name||name===label)return;
          const parent=folder.includes("/")?folder.slice(0,folder.lastIndexOf("/")+1):"";
          const next=parent+name;
          const r=await api.diskRenameFolder(folder,next);
          if(!r.ok){feedback.textContent=r.error.message;return;}
          if(current===folder||current.startsWith(folder+"/"))current=next+current.slice(folder.length);
          treeExpanded.add(parent.slice(0,-1));menu.open=false;void refresh();
        });
        menu.addEventListener("toggle",()=>{if(menu.open){field.value=label;feedback.textContent="";}});
        const operations=el("div",{cls:"disk-tree-operations"});
        const parentName=folder.includes("/")?folder.slice(0,folder.lastIndexOf("/")):"";
        const copy=button("Копировать папку",async()=>{
          const r=await api.diskFolderCopy(folder,parentName);
          if(!r.ok)feedback.textContent=r.error.message;else{menu.open=false;void refresh();}
        });
        const move=button("Переместить папку",async()=>{
          const destination=await pickDestination(folder);
          if(destination===null)return;
          const r=await api.diskFolderMove(folder,destination);
          if(!r.ok)feedback.textContent=r.error.message;
          else{menu.open=false;current="";void refresh();}
        });
        const remove=button("Удалить папку",async()=>{
          if(!confirm("Переместить папку «"+folder+"» вместе с подпапками и файлами в корзину? Восстановление доступно в разделе удалённых папок."))return;
          const r=await api.diskFolderTrash(folder);
          if(!r.ok)feedback.textContent=r.error.message;
          else{menu.open=false;current="";void refresh();}
        });
        const color=el("input",{type:"color",value:folderStyles[folder]?.color??"#b89cff",attrs:{"aria-label":"Цвет папки"}});
        const pinned=el("input",{type:"checkbox",checked:folderStyles[folder]?.pinned??false});
        const cover=el("select",{cls:"mem-select",attrs:{"aria-label":"Обложка папки"}},
          el("option",{value:"",textContent:"Без обложки"}),
          ...treeFiles.filter(f=>f.folder===folder&&/\.(png|jpe?g|webp|gif)$/i.test(f.name)).map(f=>el("option",{value:f.id,textContent:f.name})));
        cover.value=folderStyles[folder]?.cover??"";
        const style=button("Сохранить оформление",async()=>{
          const r=await api.diskFolderStyle(folder,color.value,pinned.checked,cover.value);
          if(!r.ok)feedback.textContent=r.error.message;
          else{folderStyles[folder]={color:color.value,pinned:pinned.checked,cover:cover.value};menu.open=false;renderTree();}
        });
        operations.append(copy,move,remove,color,el("label",{},pinned," Закрепить"),cover,style);
        controls.append(field,submit,rename,operations,feedback);menu.append(summary,controls);
        line.append(menu);
        line.addEventListener("dragover",e=>{if(e.dataTransfer?.types.includes("application/x-juunibi-file")||e.dataTransfer?.types.includes("application/x-juunibi-folder")){e.preventDefault();line.classList.add("disk-tree-drop");}});
        line.addEventListener("dragleave",()=>line.classList.remove("disk-tree-drop"));
        line.addEventListener("drop",async e=>{
          line.classList.remove("disk-tree-drop");
          const movedFolder=e.dataTransfer?.getData("application/x-juunibi-folder");
          if(movedFolder){e.preventDefault();if(movedFolder===folder)return;const r=await api.diskFolderMove(movedFolder,folder);if(!r.ok)showToast(r.error.message);else{current="";void refresh();}return;}
          const id=e.dataTransfer?.getData("application/x-juunibi-file");
          if(!id)return;e.preventDefault();
          const r=await api.diskMove(id,folder);if(!r.ok)showToast(r.error.message);else void refresh();
        });
      }
      if(folder){select.draggable=true;select.addEventListener("dragstart",e=>e.dataTransfer?.setData("application/x-juunibi-folder",folder));}
      if(!folder){
        line.addEventListener("dragover",e=>{if(e.dataTransfer?.types.includes("application/x-juunibi-file")||e.dataTransfer?.types.includes("application/x-juunibi-folder"))e.preventDefault();});
        line.addEventListener("drop",async e=>{
          const folderPath=e.dataTransfer?.getData("application/x-juunibi-folder");
          const id=e.dataTransfer?.getData("application/x-juunibi-file");if(!folderPath&&!id)return;
          e.preventDefault();
          const r=folderPath?await api.diskFolderMove(folderPath,""):await api.diskMove(id!,"");
          if(!r.ok)showToast(r.error.message);else{current="";void refresh();}
        });
      }
      line.append(toggle,select);line.style.paddingLeft=String(Math.min(depth,10)*13)+"px";node.append(line);
      if(folderQuery && folder && !folder.toLocaleLowerCase().includes(folderQuery) && ![...allFolders].some(f=>f.startsWith(folder+"/")&&f.toLocaleLowerCase().includes(folderQuery)))return el("span",{});
      if((expanded||!!folderQuery) && expandable){const subtree=el("div",{cls:"disk-tree-children"});for(const child of descendants)subtree.append(draw(child,depth+1));node.append(subtree);}
      return node;
    };
    const filter=el("input",{type:"search",cls:"mem-input",placeholder:"Найти папку",value:folderQuery});
    filter.addEventListener("input",()=>{const position=filter.selectionStart;folderQuery=filter.value;renderTree();const next=tree.querySelector<HTMLInputElement>("input[type=search]");next?.focus();if(position!==null)next?.setSelectionRange(position,position);});
    const sort=el("select",{cls:"mem-select"},...(["pinned","name","files","size","created"] as const).map(v=>el("option",{value:v,textContent:v==="name"?"По имени":v==="files"?"По файлам":v==="size"?"По размеру":v==="created"?"По дате создания":"Закреплённые"})));
    sort.value=folderSort;sort.addEventListener("change",()=>{folderSort=sort.value as typeof folderSort;renderTree();});
    tree.replaceChildren(el("div",{cls:"disk-tree-heading"},el("strong",{textContent:"Каталоги"}),el("small",{textContent:allFolders.length+" папок"})),filter,sort,
      draw("",0),
      button("★ Избранное",()=>{viewFilter="favorites";virtualFilter="none";current="";void refresh();}),
      button("Корзина · "+trash.length,()=>{viewFilter="trash";virtualFilter="none";current="";void refresh();}),
      ...([["images","Изображения"],["documents","Документы"],["large","Крупные файлы"],["recent","Недавние · 7 дней"]] as const).map(([kind,title])=>button("◇ "+title,()=>{virtualFilter=kind;viewFilter="all";allSearch.checked=true;current="";void refresh();})),
      button("Журнал папок",async()=>{
        const r=await api.diskFolderHistory();if(!r.ok){showToast(r.error.message);return;}
        const dialog=el("dialog",{cls:"disk-preview"});
        const rows=r.value.actions.slice(0,100).map(item=>el("div",{cls:"disk-tree-recovery"},
          el("span",{textContent:new Date(item.at).toLocaleString("ru-RU")+" · "+item.action+" · "+item.folder+(item.destination?" → "+item.destination:"")})));
        dialog.append(el("h3",{textContent:"История операций с папками"}),...rows,button("Закрыть",()=>dialog.close()));
        dialog.addEventListener("close",()=>dialog.remove(),{once:true});page.append(dialog);dialog.showModal();
      }),
      button("Удалённые папки",async()=>{
        const r=await api.diskDeletedFolders();if(!r.ok){showToast(r.error.message);return;}
        const dialog=el("dialog",{cls:"disk-preview"});
        const rows=r.value.folders.map(item=>el("div",{cls:"disk-tree-recovery"},
          el("span",{textContent:item.root+" · "+item.count+" каталогов"}),
          button("Восстановить",async()=>{const result=await api.diskFolderRestore(item.root);if(!result.ok)showToast(result.error.message);else{dialog.close();void refresh();}})));
        dialog.append(el("h3",{textContent:"Удалённые папки"}),...rows,button("Закрыть",()=>dialog.close()));
        dialog.addEventListener("close",()=>dialog.remove(),{once:true});page.append(dialog);dialog.showModal();
      }));
  };
  const refresh=async()=>{
    const r=await api.diskList(viewFilter==="all"&&!allSearch.checked?current:undefined);
    if(!r.ok){status.textContent="Диск недоступен: "+r.error.message;return;}
    items=r.value.files;trash=r.value.trash??[];allFolders=r.value.folders;
    const full=await api.diskList();
    treeFiles=full.ok?full.value.files:items;
    const styles=await api.diskFolderStyles();if(styles.ok)folderStyles=styles.value;
    selected.clear();
    breadcrumb.textContent=viewFilter==="trash"?"Диск / Корзина":viewFilter==="favorites"?"Диск / Избранное":current?"Диск / "+current:"Диск / Все файлы";
    status.textContent="Локальное хранение · До "+human(r.value.maxFileBytes)+" на файл · Данные не передаются в Cloud.ru.";
    updateStat(fileCount,String(items.length));
    updateStat(storage,human(r.value.usedBytes));
    updateStat(trashCount,String(trash.length));
    // Keep the selected tab visually distinct and accessible to screen readers.
    folders.replaceChildren(
      button("Все файлы",()=>{viewFilter="all";current="";void refresh();}),
      button("★ Избранное",()=>{viewFilter="favorites";current="";void refresh();}),
      button("Корзина ("+trash.length+")",()=>{viewFilter="trash";current="";void refresh();}),
      ...r.value.folders.map(f=>{
      const b=button(f,()=>{viewFilter="all";current=f;void refresh();});
      if(f===current)b.classList.add("selected");
      return b;
    }));
    for(const button of folders.querySelectorAll("button")){
      const active=button.textContent===(viewFilter==="trash"?"Корзина ("+trash.length+")":viewFilter==="favorites"?"★ Избранное":current||"Все файлы");
      button.classList.toggle("selected",active);
      button.setAttribute("aria-pressed",String(active));
    }
    renderTree();
    renderFiles();
  };
  let searchGeneration=0;
  const updateSearch=async()=>{
    visibleLimit=100;const generation=++searchGeneration;contentIds=null;
    if(searchContents.checked && search.value.trim().length>=2){
      try{
        const response=await fetch("/api/disk/search?q="+encodeURIComponent(search.value.trim()));
        if(!response.ok)throw new Error("Поиск недоступен");
        const result=await response.json() as {ids:string[]};
        if(generation!==searchGeneration)return;
        contentIds=new Set(result.ids);
      }catch{if(generation!==searchGeneration)return;showToast("Не удалось выполнить поиск по содержимому");}
    }
    renderFiles();
  };
  search.addEventListener("input",()=>void updateSearch());
  searchContents.addEventListener("change",()=>void updateSearch());
  const create=button("Создать папку",async()=>{
    const name=newFolder.value.trim();
    const target=current?current+"/"+name:name;
    const r=await api.diskFolder(target);
    if(!r.ok){showToast(r.error.message);return;}
    newFolder.value="";current=r.value.name;treeExpanded.add(current.includes("/")?current.slice(0,current.lastIndexOf("/")):"");void refresh();
  });
  const uploadFiles=async(fileList:File[])=>{
    if(!fileList.length)return;
    setBusy(true);
    const title=drop.querySelector("strong");
    const original=title?.textContent??"Перетащи файлы сюда";
    try{
      for(let i=0;i<fileList.length;i++){
        const file=fileList[i]!;
        if(file.size>50*1024*1024){showToast(file.name+": размер больше 50 МБ");continue;}
        if(title)title.textContent="Загрузка "+(i+1)+"/"+fileList.length+" · 0%";
        await new Promise<void>(resolve=>{
          const xhr=new XMLHttpRequest();
          xhr.open("POST","/api/disk/files/binary?name="+encodeURIComponent(file.name)+"&folder="+encodeURIComponent(current));
          xhr.setRequestHeader("Content-Type","application/octet-stream");
          xhr.upload.onprogress=(ev)=>{
            if(ev.lengthComputable&&title)title.textContent="Загрузка "+(i+1)+"/"+fileList.length+" · "+Math.round(ev.loaded/ev.total*100)+"%";
          };
          xhr.onload=()=>{if(xhr.status!==201)showToast(file.name+": загрузка не удалась");resolve();};
          xhr.onerror=()=>{showToast(file.name+": ошибка сети");resolve();};
          xhr.onabort=()=>resolve();
          xhr.send(file);
        });
      }
    }finally{if(title)title.textContent=original;setBusy(false);upload.value="";void refresh();}
  };
  upload.addEventListener("change",()=>void uploadFiles([...(upload.files??[])]));
  drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("active");});
  drop.addEventListener("dragleave",()=>drop.classList.remove("active"));
  drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("active");if(e.dataTransfer?.files.length)void uploadFiles([...e.dataTransfer.files]);});
  const hideTree=button("Скрыть / показать дерево",()=>{treeHidden=!treeHidden;tree.hidden=treeHidden;});
  const catalog=el("div",{cls:"disk-catalog"},tree,el("section",{cls:"disk-catalog-content"},el("div",{cls:"disk-controls"},breadcrumb,search,el("label",{},allSearch,"Все папки"),el("label",{},searchContents,"В тексте"),sortSelect,viewButton),drop,bulkBar,files,details));
  page.append(el("h1",{textContent:"Диск"}),hero,status,el("div",{cls:"disk-toolbar"},newFolder,create,upload,statsButton,toolsButton,exportButton,backupButton,restoreBackupButton,hideTree,clipboardButton,cutButton,pasteButton,undoButton,historyButton,extension,grouping),catalog);
  void refresh();
  return page;
}
