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
  let current="",items:DiskFile[]=[];
  const renderFiles=()=>{
    const q=search.value.trim().toLocaleLowerCase();
    const shown=items.filter(f=>!q||f.name.toLocaleLowerCase().includes(q));
    files.replaceChildren(...(shown.length?shown.map(f=>{
      const name=el("strong",{textContent:f.name});
      const card=el("div",{cls:"disk-file"});
      const download=button("Скачать",async()=>{
        const r=await api.diskGet(f.id);
        if(!r.ok){showToast(r.error.message);return;}
        const binary=atob(r.value.base64);
        const bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        const url=URL.createObjectURL(new Blob([bytes]));
        const link=document.createElement("a");link.href=url;link.download=f.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      });
      const del=button("Удалить",async()=>{
        if(!confirm("Удалить файл «"+f.name+"» без возможности восстановления?"))return;
        const r=await api.diskDelete(f.id);
        if(!r.ok)showToast(r.error.message);else void refresh();
      });
      card.append(el("span",{cls:"disk-file-icon"},icon("folder",20)),el("div",{cls:"disk-file-info"},name,el("small",{cls:"muted",textContent:human(f.size)+" · "+new Date(f.uploadedAt).toLocaleDateString("ru-RU")})),download,del);
      return card;
    }):[el("p",{cls:"muted",textContent:q?"Ничего не найдено":"Здесь пока нет файлов."})]));
  };
  const refresh=async()=>{
    const r=await api.diskList(current);
    if(!r.ok){status.textContent="Диск недоступен: "+r.error.message;return;}
    items=r.value.files;
    status.textContent="Занято: "+human(r.value.usedBytes)+" · Файлов в папке: "+items.length+" · До "+human(r.value.maxFileBytes)+" на файл. Файлы хранятся на этом компьютере.";
    folders.replaceChildren(...["",...r.value.folders].map(f=>{
      const b=button(f||"Все файлы",()=>{current=f;void refresh();});
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
  upload.addEventListener("change",async()=>{
    for(const file of [...(upload.files??[])]){
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
  });
  page.append(el("h1",{textContent:"Диск"}),el("p",{cls:"muted",textContent:"Документы и файлы в одном месте. Создавай папки, находи нужное, скачивай и удаляй."}),
    status,el("div",{cls:"disk-toolbar"},newFolder,create,upload),folders,search,files);
  void refresh();
  return page;
}
