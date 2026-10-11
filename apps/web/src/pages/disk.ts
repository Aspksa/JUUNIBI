/** Personal JUUNIBI Disk: a compact owner-facing file explorer. */
import {api,type DiskFile} from "../api";
import {el,icon} from "../dom";
import {showToast} from "../toast";

const human=(b:number)=>b<1024?b+" Б":b<1048576?(b/1024).toFixed(1)+" КБ":(b/1048576).toFixed(1)+" МБ";
const button=(label:string,fn:()=>void)=>{const b=el("button",{type:"button",cls:"mem-btn",textContent:label});b.addEventListener("click",fn);return b;};
export function diskPage():HTMLElement {
  const page=el("div",{cls:"pg disk-page"});
  const status=el("p",{cls:"muted small",textContent:"Личное локальное хранилище. Документы не отправляются в Cloud.ru."});
  const folders=el("div",{cls:"disk-folders"});
  const files=el("div",{cls:"disk-files"});
  const search=el("input",{type:"search",cls:"mem-input",placeholder:"Поиск по названиям файлов",attrs:{"aria-label":"Поиск файлов"}});
  const upload=el("input",{type:"file",multiple:true,attrs:{"aria-label":"Выбрать файлы для загрузки"}});
  const newFolder=el("input",{type:"text",cls:"mem-input",maxLength:80,placeholder:"Новая папка",attrs:{"aria-label":"Название новой папки"}});
  let current="",items:DiskFile[]=[],trash:DiskFile[]=[],allFolders:string[]=[];
  let viewFilter:"all"|"favorites"|"trash"="all";
  let gridMode=localStorage.getItem("juunibi.disk.grid")!=="false";
  const viewButton=button("Вид: плитка",()=>{gridMode=!gridMode;localStorage.setItem("juunibi.disk.grid",String(gridMode));renderFiles();});
  const sortSelect=el("select",{cls:"mem-select",attrs:{"aria-label":"Сортировать файлы"}},el("option",{value:"new",textContent:"Сначала новые"}),el("option",{value:"name",textContent:"По имени"}),el("option",{value:"size",textContent:"По размеру"}));
  sortSelect.addEventListener("change",()=>renderFiles());
  const breadcrumb=el("span",{cls:"muted small"});
  const drop=el("div",{cls:"disk-drop"},icon("folder",24),el("strong",{textContent:"Перетащи файлы сюда"}),el("span",{cls:"muted small",textContent:"До 10 МБ на файл"}));
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
    const q=search.value.trim().toLocaleLowerCase();
    const shown=(viewFilter==="trash"?trash:items.filter(f=>viewFilter!=="favorites"||f.favorite)).filter(f=>!q||f.name.toLocaleLowerCase().includes(q)).sort((a,b)=>sortSelect.value==="name"?a.name.localeCompare(b.name,"ru"):sortSelect.value==="size"?b.size-a.size:b.uploadedAt.localeCompare(a.uploadedAt));
    files.classList.toggle("disk-grid",gridMode);
    files.classList.toggle("disk-list",!gridMode);
    viewButton.textContent=gridMode?"Вид: плитка":"Вид: список";
    files.replaceChildren(...(shown.length?shown.map(f=>{
      const name=el("strong",{textContent:f.name});
      const card=el("div",{cls:"disk-file"});
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
        if(!r.ok)showToast(r.error.message);else void refresh();
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
        if(!r.ok)showToast(r.error.message);else void refresh();
      });
      const restore=button("Восстановить",async()=>{actions.open=false;const r=await api.diskRestore(f.id);if(!r.ok)showToast(r.error.message);else void refresh();});
      const purge=button("Удалить навсегда",async()=>{
        actions.open=false;if(!confirm("Безвозвратно удалить «"+f.name+"»?"))return;
        const r=await api.diskPurge(f.id);if(!r.ok)showToast(r.error.message);else void refresh();
      });
      actions.append(summary,el("div",{cls:"disk-actions-menu"},...(viewFilter==="trash"?[restore,purge]:[show,favorite,move,rename,download,del])));
      const open=button(viewFilter==="trash"?"В корзине":"Открыть",()=>{if(viewFilter!=="trash")void openPreview(f);});
      open.disabled=viewFilter==="trash";
      card.append(el("span",{cls:"disk-file-icon"},icon("folder",20)),el("div",{cls:"disk-file-info"},name,el("small",{cls:"muted",textContent:human(f.size)+" · "+new Date(f.uploadedAt).toLocaleDateString("ru-RU")})),open,actions);
      return card;
    }):[el("p",{cls:"muted",textContent:q?"Ничего не найдено":"Здесь пока нет файлов."})]));
  };
  const refresh=async()=>{
    const r=await api.diskList(viewFilter==="all"?current:undefined);
    if(!r.ok){status.textContent="Диск недоступен: "+r.error.message;return;}
    items=r.value.files;trash=r.value.trash??[];allFolders=r.value.folders;
    breadcrumb.textContent=viewFilter==="trash"?"Диск / Корзина":viewFilter==="favorites"?"Диск / Избранное":current?"Диск / "+current:"Диск / Все файлы";
    status.textContent="Занято: "+human(r.value.usedBytes)+" · Файлов в папке: "+items.length+" · До "+human(r.value.maxFileBytes)+" на файл. Файлы хранятся на этом компьютере.";
    folders.replaceChildren(
      button("Все файлы",()=>{viewFilter="all";current="";void refresh();}),
      button("★ Избранное",()=>{viewFilter="favorites";current="";void refresh();}),
      button("Корзина ("+trash.length+")",()=>{viewFilter="trash";current="";void refresh();}),
      ...r.value.folders.map(f=>{
      const b=button(f,()=>{viewFilter="all";current=f;void refresh();});
      if(f===current)b.classList.add("selected");
      return b;
    }));
    renderFiles();
  };
  search.addEventListener("input",renderFiles);
  const create=button("Создать папку",async()=>{
    const r=await api.diskFolder(newFolder.value.trim());
    if(!r.ok){showToast(r.error.message);return;}
    newFolder.value="";current=r.value.name;void refresh();
  });
  const uploadFiles=async(fileList:File[])=>{
    for(const file of fileList){
      if(file.size>10*1024*1024){showToast(file.name+": размер больше 10 МБ");continue;}
      const encoded=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result).split(",")[1]??"");
        reader.onerror=()=>reject(reader.error);
        reader.readAsDataURL(file);
      });
      const r=await api.diskUpload(file.name,current,encoded);
      if(!r.ok)showToast(r.error.message);
    }
    upload.value="";void refresh();
  };
  upload.addEventListener("change",()=>void uploadFiles([...(upload.files??[])]));
  drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("active");});
  drop.addEventListener("dragleave",()=>drop.classList.remove("active"));
  drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("active");if(e.dataTransfer?.files.length)void uploadFiles([...e.dataTransfer.files]);});
  page.append(el("h1",{textContent:"Диск"}),el("p",{cls:"muted",textContent:"Документы и файлы в одном месте. Создавай папки, находи нужное, скачивай и удаляй."}),
    status,el("div",{cls:"disk-toolbar"},newFolder,create,upload),folders,el("div",{cls:"disk-controls"},breadcrumb,search,sortSelect,viewButton),drop,files);
  void refresh();
  return page;
}
