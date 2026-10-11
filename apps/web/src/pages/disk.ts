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
  const search=el("input",{type:"search",cls:"mem-input",placeholder:"Поиск файлов",attrs:{"aria-label":"Поиск файлов"}});
  const searchContents=el("input",{type:"checkbox",attrs:{"aria-label":"Искать внутри текстовых файлов"}});
  const upload=el("input",{type:"file",multiple:true,attrs:{"aria-label":"Выбрать файлы для загрузки"}});
  const newFolder=el("input",{type:"text",cls:"mem-input",maxLength:80,placeholder:"Новая папка",attrs:{"aria-label":"Название новой папки"}});
  let current="",items:DiskFile[]=[],trash:DiskFile[]=[],allFolders:string[]=[];
  let visibleLimit=100;
  let contentIds:Set<string>|null=null;
  let viewFilter:"all"|"favorites"|"trash"="all";
  let gridMode=localStorage.getItem("juunibi.disk.grid")!=="false";
  const selected=new Set<string>();
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
  const allFiles=()=>viewFilter==="trash"?trash:items.filter(f=>viewFilter!=="favorites"||f.favorite);
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
    const shown=allFiles().filter(f=>!q||f.name.toLocaleLowerCase().includes(q)||(contentIds?.has(f.id)??false)).sort((a,b)=>sortSelect.value==="name"?a.name.localeCompare(b.name,"ru"):sortSelect.value==="size"?b.size-a.size:b.uploadedAt.localeCompare(a.uploadedAt));
    files.classList.toggle("disk-grid",gridMode);
    files.classList.toggle("disk-list",!gridMode);
    viewButton.textContent=gridMode?"Вид: плитка":"Вид: список";
    const visible=shown.slice(0,visibleLimit);
    files.replaceChildren(...(visible.length?visible.map((f,index)=>{
      const name=el("strong",{textContent:f.name});
      const card=el("div",{cls:"disk-file"+(firstPaint&&index<16?" disk-reveal":"")});
      card.dataset.fileId=f.id;
      if(firstPaint&&index<16)card.style.setProperty("--disk-order",String(index));
      const choose=el("input",{type:"checkbox",checked:selected.has(f.id),attrs:{"aria-label":"Выбрать "+f.name}});
      choose.addEventListener("change",()=>{if(choose.checked)selected.add(f.id);else selected.delete(f.id);card.classList.toggle("disk-selected",choose.checked);renderBulk();});
      card.classList.toggle("disk-selected",selected.has(f.id));
      const thumbnail=el("span",{cls:"disk-file-icon"},diskIcon("vault"));
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
      const favorite=button(f.favorite?"★ Убрать из избранного":"☆ В избранное",async()=>{
        actions.open=false;const r=await api.diskFavorite(f.id,!f.favorite);
        if(!r.ok)showToast(r.error.message);else void refresh();
      });
      const move=button("Переместить в папку",async()=>{
        actions.open=false;
        const folder=prompt("Папка (доступные: "+["Главная",...allFolders].join(", ")+"). Пустое поле — главная.",f.folder);
        if(folder===null)return;
        const r=await api.diskMove(f.id,folder.trim());
        if(!r.ok)showToast(r.error.message);else {await exitFile(f.id);void refresh();}
      });
      const restore=button("Восстановить",async()=>{actions.open=false;const r=await api.diskRestore(f.id);if(!r.ok)showToast(r.error.message);else {await exitFile(f.id);void refresh();}});
      const purge=button("Удалить навсегда",async()=>{
        actions.open=false;if(!confirm("Безвозвратно удалить «"+f.name+"»?"))return;
        const r=await api.diskPurge(f.id);if(!r.ok)showToast(r.error.message);else void refresh();
      });
      actions.append(summary,el("div",{cls:"disk-actions-menu"},...(viewFilter==="trash"?[restore,purge]:[show,favorite,move,rename,download,del])));
      const open=button(viewFilter==="trash"?"В корзине":"Открыть",()=>{if(viewFilter!=="trash")void openPreview(f);});
      open.disabled=viewFilter==="trash";
      card.append(choose,thumbnail,el("div",{cls:"disk-file-info"},name,el("small",{cls:"muted",textContent:human(f.size)+" · "+new Date(f.uploadedAt).toLocaleDateString("ru-RU")})),open,actions);
      return card;
    }):[el("p",{cls:"muted",textContent:q?"Ничего не найдено":"Здесь пока нет файлов."})]));
    if(shown.length>visible.length)files.append(button("Показать ещё ("+(shown.length-visible.length)+")",()=>{visibleLimit+=100;renderFiles();}));
    renderBulk();
    firstPaint=false;
    if(gridMode&&viewFilter!=="trash")void thumbnails(visible);
  };
  const renderTree=()=>{
    const counts=new Map<string,number>();
    for(const file of items){
      let p=file.folder;
      counts.set("",(counts.get("")??0)+1);
      while(p){counts.set(p,(counts.get(p)??0)+1);p=p.includes("/")?p.slice(0,p.lastIndexOf("/")):"";}
    }
    const children=new Map<string,string[]>();
    for(const full of allFolders){
      const parent=full.includes("/")?full.slice(0,full.lastIndexOf("/")):"";
      const list=children.get(parent)??[];list.push(full);children.set(parent,list);
    }
    for(const list of children.values())list.sort((a,b)=>a.localeCompare(b,"ru"));
    const openFolder=(folder:string)=>{
      current=folder;viewFilter="all";selected.clear();visibleLimit=100;
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
      const select=el("button",{type:"button",cls:"disk-tree-select",attrs:{"aria-current":current===folder&&viewFilter==="all"?"page":"false"}},icon("folder",16),el("span",{textContent:label}),el("small",{textContent:String(counts.get(folder)??0)}));
      select.addEventListener("click",()=>openFolder(folder));
      line.append(toggle,select);line.style.paddingLeft=String(Math.min(depth,10)*13)+"px";node.append(line);
      if(expanded && expandable){const subtree=el("div",{cls:"disk-tree-children"});for(const child of descendants)subtree.append(draw(child,depth+1));node.append(subtree);}
      return node;
    };
    tree.replaceChildren(el("div",{cls:"disk-tree-heading"},el("strong",{textContent:"Каталоги"}),el("small",{textContent:allFolders.length+" папок"})),
      draw("",0),...((children.get("")??[]).map(p=>draw(p,1))),
      button("★ Избранное",()=>{viewFilter="favorites";current="";void refresh();}),
      button("Корзина · "+trash.length,()=>{viewFilter="trash";current="";void refresh();}));
  };
  const refresh=async()=>{
    const r=await api.diskList(viewFilter==="all"&&!allSearch.checked?current:undefined);
    if(!r.ok){status.textContent="Диск недоступен: "+r.error.message;return;}
    items=r.value.files;trash=r.value.trash??[];allFolders=r.value.folders;
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
  const catalog=el("div",{cls:"disk-catalog"},tree,el("section",{cls:"disk-catalog-content"},el("div",{cls:"disk-controls"},breadcrumb,search,el("label",{},allSearch,"Все папки"),el("label",{},searchContents,"В тексте"),sortSelect,viewButton),drop,bulkBar,files));
  page.append(el("h1",{textContent:"Диск"}),hero,status,el("div",{cls:"disk-toolbar"},newFolder,create,upload,statsButton),catalog);
  void refresh();
  return page;
}
