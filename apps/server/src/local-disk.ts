import { diskChronicles } from "./disk-chronicles";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";

/** Local, owner-controlled vault. Files are never sent to a cloud service. */
export type DiskEntry = { id:string; name:string; folder:string; size:number; uploadedAt:string; sha256:string; favorite?:boolean; deletedAt?:string; tags?:string[]; color?:string; note?:string };
const LIMIT = 50 * 1024 * 1024;
const bad = (message:string,status=400)=>Object.assign(new Error(message),{status});
const validFolder = (name:unknown) => {
  if (typeof name!=="string" || name.length>240 || (name!=="" && name.split("/").some(part=>!part || part.length>80 || !/^[a-zA-Zа-яА-ЯёЁ0-9 _.-]+$/.test(part) || part==="." || part==="..")) || name.includes("\\")) throw bad("Имя папки: до 80 букв или цифр, без пути");
  return name.trim();
};
const validName = (v:unknown) => {
  if (typeof v!=="string" || !v.trim() || v.length>180 || /[\\/\x00-\x1f]/.test(v) || v==="." || v==="..") throw bad("Недопустимое имя файла");
  return v.trim();
};
export class LocalDisk {
  private entries:DiskEntry[]=[];
  private folders:string[]=[];
  private folderStyles:Record<string,{color:string;pinned:boolean;cover:string;createdAt?:string}>={};
  private folderActions:{at:string;action:string;folder:string;destination?:string;files?:number}[]=[];
  private logFolder(action:string,folder:string,destination?:string,files?:number){this.folderActions.push({at:new Date().toISOString(),action,folder,...(destination===undefined?{}:{destination}),...(files===undefined?{}:{files})});if(this.folderActions.length>300)this.folderActions.shift();}
  folderHistory(){return [...this.folderActions].reverse();}
  private deletedFolders:{root:string;paths:string[];at:string;styles:Record<string,{color:string;pinned:boolean;cover:string}>}[]=[];
  private writes:Promise<void>=Promise.resolve();
  constructor(private readonly root:string) {}
  private get index(){return path.join(this.root,"index.json");}
  private file(id:string){return path.join(this.root,"objects",id);}
  async load(){
    try {
      const raw=JSON.parse(await readFile(this.index,"utf8")) as {entries?:DiskEntry[];folders?:string[];folderStyles?:Record<string,{color:string;pinned:boolean;cover:string}>;folderActions?:{at:string;action:string;folder:string;destination?:string;files?:number}[];fileActions?:{id:string;before:{name:string;folder:string};after:{name:string;folder:string};at:string}[];deletedFolders?:{root:string;paths:string[];at:string;styles:Record<string,{color:string;pinned:boolean;cover:string}>}[]};
      if(Array.isArray(raw.entries)) this.entries=raw.entries.filter(x=>!!x&&typeof x.id==="string"&&/^[0-9a-f-]{36}$/.test(x.id)&&typeof x.name==="string"&&typeof x.folder==="string"&&Number.isSafeInteger(x.size)&&typeof x.sha256==="string");
      if(raw.folderStyles&&typeof raw.folderStyles==="object")this.folderStyles=raw.folderStyles;
      if(Array.isArray(raw.fileActions))this.fileActions=raw.fileActions.slice(-300);
      if(Array.isArray(raw.folderActions))this.folderActions=raw.folderActions.slice(-300);
      if(Array.isArray(raw.deletedFolders))this.deletedFolders=raw.deletedFolders;
      if(Array.isArray(raw.folders)) this.folders=raw.folders.filter(x=>{try{return validFolder(x)===x&&!!x;}catch{return false;}});
    }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
  private save(){
    const content=JSON.stringify({entries:this.entries,folders:this.folders,folderStyles:this.folderStyles,folderActions:this.folderActions,fileActions:this.fileActions,deletedFolders:this.deletedFolders});
    this.writes=this.writes.catch(()=>{}).then(async()=>{
      await mkdir(this.root,{recursive:true});
      const tmp=path.join(this.root,randomUUID()+".tmp");
      await writeFile(tmp,content,{mode:0o600});
      await rename(tmp,this.index);
    });
    return this.writes;
  }
  chronicles(){return diskChronicles(this.entries,this.folders);}
  list(folder?:string){
    const f=folder===undefined?undefined:validFolder(folder);
    return {folders:[...this.folders].sort(),files:this.entries.filter(e=>!e.deletedAt&&(f===undefined||e.folder===f)).map(e=>({...e})).sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt)),trash:this.entries.filter(e=>!!e.deletedAt).map(e=>({...e})).sort((a,b)=>(b.deletedAt??"").localeCompare(a.deletedAt??"")),usedBytes:this.entries.reduce((n,e)=>n+e.size,0),maxFileBytes:LIMIT};
  }
  async createFolder(name:unknown){
    const f=validFolder(name);
    if(!f)throw bad("Укажите название папки");
    if(this.folders.includes(f))throw bad("Такая папка уже есть",409);
    const parent=f.includes("/")?f.slice(0,f.lastIndexOf("/")):"";
    if(parent&&!this.folders.includes(parent))throw bad("Сначала создайте родительскую папку",404);
    if(this.folders.length>=100)throw bad("Слишком много папок",409);
    this.folders.push(f);this.folderStyles[f]={color:"#b89cff",pinned:false,cover:"",createdAt:new Date().toISOString()};this.logFolder("create",f);await this.save();return {name:f};
  }
  async renameFolder(oldName:unknown,newName:unknown){
    const from=validFolder(oldName),to=validFolder(newName);
    if(!from||!to||!this.folders.includes(from))throw bad("Папка не найдена",404);
    if(from===to)return {name:from};
    if(to.startsWith(from+"/"))throw bad("Нельзя перенести папку внутрь себя");
    const parent=to.includes("/")?to.slice(0,to.lastIndexOf("/")):"";
    if(parent&&!this.folders.includes(parent))throw bad("Родительская папка не найдена",404);
    const affected=this.folders.filter(f=>f===from||f.startsWith(from+"/"));
    const renamed=(f:string)=>to+f.slice(from.length);
    if(this.folders.some(f=>!affected.includes(f)&&affected.some(a=>renamed(a)===f)))throw bad("Папка с таким именем уже существует",409);
    this.folders=this.folders.map(f=>affected.includes(f)?renamed(f):f);
    for(const f of affected){if(this.folderStyles[f]){this.folderStyles[renamed(f)]=this.folderStyles[f]!;delete this.folderStyles[f];}}
    for(const entry of this.entries)if(entry.folder===from||entry.folder.startsWith(from+"/"))entry.folder=renamed(entry.folder);
    this.logFolder("rename",from,to);await this.save();return {name:to};
  }
  /** Move an entire branch, reusing collision checks in renameFolder. */
  async moveFolder(from:unknown,parent:unknown){
    const src=validFolder(from),dest=validFolder(parent);
    if(!src||!this.folders.includes(src))throw bad("Папка не найдена",404);
    if(dest&&!this.folders.includes(dest))throw bad("Папка назначения не найдена",404);
    return this.renameFolder(src,(dest?dest+"/":"")+src.split("/").pop()!);
  }
  async setFolderStyle(name:unknown,color:unknown,pinned:unknown,cover:unknown){
    const folder=validFolder(name);
    if(!this.folders.includes(folder))throw bad("Папка не найдена",404);
    if(typeof color!=="string"||!/^#[0-9a-fA-F]{6}$/.test(color))throw bad("Неверный цвет");
    if(typeof pinned!=="boolean")throw bad("Неверное значение закрепления");
    if(typeof cover!=="string"||cover.length>100)throw bad("Неверная обложка");
    if(cover&&!this.entries.some(e=>e.id===cover&&!e.deletedAt&&e.folder===folder&&/\.(png|jpe?g|gif|webp)$/i.test(e.name)))throw bad("Выберите изображение из этой папки",400);
    this.folderStyles[folder]={color,pinned,cover,...(this.folderStyles[folder]?.createdAt?{createdAt:this.folderStyles[folder]!.createdAt}:{})};
    this.logFolder("style",folder);await this.save();return {name:folder,...this.folderStyles[folder]};
  }
  folderDecorations(){return {...this.folderStyles};}
  async copyFolder(source:unknown,parent:unknown){
    const from=validFolder(source),toParent=validFolder(parent);
    if(!from||!this.folders.includes(from))throw bad("Папка не найдена",404);
    if(toParent&&!this.folders.includes(toParent))throw bad("Папка назначения не найдена",404);
    const original=(toParent?toParent+"/":"")+from.split("/").pop()!;
    let target=original+" - копия",number=2;
    while(this.folders.includes(target)){target=original+" - копия "+number++;if(number>1000)throw bad("Нельзя выбрать имя копии",409);}
    const folders=this.folders.filter(f=>f===from||f.startsWith(from+"/"));
    const entries=this.entries.filter(e=>!e.deletedAt&&(e.folder===from||e.folder.startsWith(from+"/")));
    if(this.folders.length+folders.length>100||this.entries.length+entries.length>1000)throw bad("Превышен лимит хранилища",409);
    const copied:string[]=[];
    try{
      for(const e of entries){
        const bytes=await readFile(this.file(e.id));
        if(createHash("sha256").update(bytes).digest("hex")!==e.sha256)throw bad("Повреждён исходный файл",409);
        const id=randomUUID();await writeFile(this.file(id),bytes,{flag:"wx",mode:0o600});
        copied.push(id);
      }
    }catch(e){for(const id of copied)await rm(this.file(id),{force:true});throw e;}
    this.folders.push(...folders.map(f=>target+f.slice(from.length)));
    for(const folder of folders)this.folderStyles[target+folder.slice(from.length)]={...(this.folderStyles[folder]??{color:"#b89cff",pinned:false,cover:""}),createdAt:new Date().toISOString()};
    this.entries.push(...entries.map((e,i)=>({...e,id:copied[i]!,folder:target+e.folder.slice(from.length),uploadedAt:new Date().toISOString()})));
    this.logFolder("copy",from,target,copied.length);await this.save();return {name:target,files:copied.length};
  }
  listDeletedFolders(){return this.deletedFolders.map(({root,paths,at})=>({root,count:paths.length,at}));}
  async restoreFolder(name:unknown){
    const root=validFolder(name),index=this.deletedFolders.findIndex(f=>f.root===root);
    if(index<0)throw bad("Удалённая папка не найдена",404);
    const item=this.deletedFolders[index]!;
    const parent=root.includes("/")?root.slice(0,root.lastIndexOf("/")):"";
    if(parent&&!this.folders.includes(parent))throw bad("Сначала восстановите родительскую папку",409);
    if(item.paths.some(p=>this.folders.includes(p))||this.folders.length+item.paths.length>100)throw bad("Пути папок заняты или превышен лимит",409);
    this.folders.push(...item.paths);
    Object.assign(this.folderStyles,item.styles);
    for(const e of this.entries)if(e.deletedAt===item.at&&(e.folder===root||e.folder.startsWith(root+"/")))delete e.deletedAt;
    this.deletedFolders.splice(index,1);
    this.logFolder("restore",root);await this.save();return {root,files:this.entries.filter(e=>!e.deletedAt&&(e.folder===root||e.folder.startsWith(root+"/"))).length};
  }
  async trashFolder(name:unknown){
    const folder=validFolder(name);
    if(!folder||!this.folders.includes(folder))throw bad("Папка не найдена",404);
    const entries=this.entries.filter(e=>!e.deletedAt&&(e.folder===folder||e.folder.startsWith(folder+"/")));
    const at=new Date().toISOString();
    for(const e of entries)e.deletedAt=at;
    const paths=this.folders.filter(f=>f===folder||f.startsWith(folder+"/"));
    const styles:Record<string,{color:string;pinned:boolean;cover:string}>={};
    for(const p of paths){if(this.folderStyles[p]){styles[p]=this.folderStyles[p]!;delete this.folderStyles[p];}}
    this.deletedFolders.push({root:folder,paths,at,styles});
    this.folders=this.folders.filter(f=>!paths.includes(f));
    this.logFolder("trash",folder,undefined,entries.length);await this.save();return {files:entries.length,folder};
  }
  async upload(name:unknown,folder:unknown,data:unknown){
    const filename=validName(name), f=validFolder(folder);
    if(f&&!this.folders.includes(f))throw bad("Папка не найдена",404);
    if(typeof data!=="string"||data.length>Math.ceil(LIMIT*4/3)+8||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw bad("Некорректный файл или превышен лимит 50 МБ",413);
    const buf=Buffer.from(data,"base64");
    if(!buf.length||buf.length>LIMIT)throw bad("Файл должен быть от 1 байта до 10 МБ",413);
    if(this.entries.length>=1000)throw bad("Достигнут лимит 1000 файлов",409);
    const entry:DiskEntry={id:randomUUID(),name:filename,folder:f,size:buf.length,uploadedAt:new Date().toISOString(),sha256:createHash("sha256").update(buf).digest("hex")};
    await mkdir(path.join(this.root,"objects"),{recursive:true});
    await writeFile(this.file(entry.id),buf,{flag:"wx",mode:0o600});
    this.entries.push(entry);
    try{await this.save();}catch(e){this.entries=this.entries.filter(x=>x.id!==entry.id);await rm(this.file(entry.id),{force:true});throw e;}
    return {...entry};
  }
  /** Search small text documents on disk; never sends their contents to a model. */
  async searchContent(query:string):Promise<string[]>{
    const q=query.trim().toLocaleLowerCase();
    if(q.length<2||q.length>160)throw bad("Поиск: от 2 до 160 символов");
    const ids:string[]=[];
    for(const entry of this.entries){
      if(entry.deletedAt || !/\.(txt|md|csv|json|log|ts|tsx|js|mjs|css|html)$/i.test(entry.name) || entry.size>1024*1024)continue;
      try {
        const buf=await readFile(this.file(entry.id));
        if(createHash("sha256").update(buf).digest("hex")===entry.sha256 && buf.toString("utf8").toLocaleLowerCase().includes(q))ids.push(entry.id);
      } catch { /* An unreadable file is never reported as a match. */ }
    }
    return ids;
  }
  /** Bounded streaming write: bytes are never assembled into one large request buffer. */
  async uploadStream(name:unknown,folder:unknown,stream:AsyncIterable<Buffer>){
    const filename=validName(name),f=validFolder(folder);
    if(f&&!this.folders.includes(f))throw bad("Папка не найдена",404);
    if(this.entries.length>=1000)throw bad("Достигнут лимит 1000 файлов",409);
    await mkdir(path.join(this.root,"objects"),{recursive:true});
    const id=randomUUID(),temp=this.file(id)+".part";
    const handle=await open(temp,"wx",0o600);
    let size=0;const hash=createHash("sha256");
    try{
      for await(const chunk of stream){
        size+=chunk.length;
        if(size>LIMIT)throw bad("Файл превышает 50 МБ",413);
        hash.update(chunk);
        let offset=0;
        while(offset<chunk.length){
          const written=await handle.write(chunk,offset,chunk.length-offset,null);
          if(!written.bytesWritten)throw new Error("Запись файла прервана");
          offset+=written.bytesWritten;
        }
      }
      if(!size)throw bad("Пустой файл",413);
    }catch(e){await handle.close();await rm(temp,{force:true});throw e;}
    await handle.close();
    await rename(temp,this.file(id));
    const entry:DiskEntry={id,name:filename,folder:f,size,uploadedAt:new Date().toISOString(),sha256:hash.digest("hex")};
    this.entries.push(entry);
    try{await this.save();}catch(e){this.entries=this.entries.filter(x=>x.id!==id);await rm(this.file(id),{force:true});throw e;}
    return {...entry};
  }
  /** Binary upload path shared by the streaming endpoint. */
  async uploadBytes(name:unknown,folder:unknown,buf:Buffer){
    const filename=validName(name),f=validFolder(folder);
    if(f&&!this.folders.includes(f))throw bad("Папка не найдена",404);
    if(!buf.length||buf.length>LIMIT)throw bad("Файл должен быть от 1 байта до 50 МБ",413);
    if(this.entries.length>=1000)throw bad("Достигнут лимит 1000 файлов",409);
    const entry:DiskEntry={id:randomUUID(),name:filename,folder:f,size:buf.length,uploadedAt:new Date().toISOString(),sha256:createHash("sha256").update(buf).digest("hex")};
    await mkdir(path.join(this.root,"objects"),{recursive:true});
    await writeFile(this.file(entry.id),buf,{flag:"wx",mode:0o600});
    this.entries.push(entry);
    try{await this.save();}catch(e){this.entries=this.entries.filter(x=>x.id!==entry.id);await rm(this.file(entry.id),{force:true});throw e;}
    return {...entry};
  }
  async download(id:string){
    const entry=this.entries.find(x=>x.id===id);
    if(!entry || entry.deletedAt)throw bad("Файл не найден",404);
    const data=await readFile(this.file(entry.id));
    if(createHash("sha256").update(data).digest("hex")!==entry.sha256)throw bad("Файл повреждён: контрольная сумма не совпадает",409);
    return {entry:{...entry},base64:data.toString("base64")};
  }
  /** Local integrity audit: file size and SHA-256 are checked without cloud transfer. */
  async audit(){
    const results:{id:string;name:string;status:"ok"|"missing"|"corrupt"}[]=[];
    for(const e of this.entries){
      try{
        const bytes=await readFile(this.file(e.id));
        const valid=bytes.length===e.size&&createHash("sha256").update(bytes).digest("hex")===e.sha256;
        results.push({id:e.id,name:e.name,status:valid?"ok":"corrupt"});
      }catch{results.push({id:e.id,name:e.name,status:"missing"});}
    }
    return {total:results.length,ok:results.filter(x=>x.status==="ok").length,results};
  }
  duplicates(){
    const groups=new Map<string,DiskEntry[]>();
    for(const e of this.entries.filter(x=>!x.deletedAt)){
      const key=e.sha256+":"+e.size,group=groups.get(key)??[];
      group.push({...e});groups.set(key,group);
    }
    return [...groups.values()].filter(group=>group.length>1);
  }
  async setMetadata(id:string,input:{tags?:unknown;color?:unknown;note?:unknown}){
    const e=this.entries.find(x=>x.id===id&&!x.deletedAt);
    if(!e)throw bad("Файл не найден",404);
    if(input.tags!==undefined){
      if(!Array.isArray(input.tags)||input.tags.length>12||input.tags.some(t=>typeof t!=="string"||t.length>32||!t.trim()))throw bad("Не более 12 тегов по 32 символа");
      e.tags=[...new Set((input.tags as string[]).map(t=>t.trim()))];
    }
    if(input.color!==undefined){
      if(typeof input.color!=="string"||!/^#[0-9a-fA-F]{6}$/.test(input.color))throw bad("Недопустимый цвет");
      e.color=input.color;
    }
    if(input.note!==undefined){
      if(typeof input.note!=="string"||input.note.length>2000)throw bad("Описание слишком длинное");
      e.note=input.note;
    }
    await this.save();return {...e};
  }
  /** Export an explicit snapshot of metadata; bytes are not included. */
  snapshot(){return {exportedAt:new Date().toISOString(),files:this.entries.map(e=>({...e})),folders:[...this.folders]};}
  /** Copy a file under a new identity without changing its original. */
  async copyFile(id:string,folder:unknown){
    const original=this.entries.find(e=>e.id===id&&!e.deletedAt);
    if(!original)throw bad("Файл не найден",404);
    const target=validFolder(folder);
    if(target&&!this.folders.includes(target))throw bad("Папка назначения не найдена",404);
    if(this.entries.length>=1000)throw bad("Достигнут лимит 1000 файлов",409);
    const bytes=await readFile(this.file(id));
    if(bytes.length!==original.size||createHash("sha256").update(bytes).digest("hex")!==original.sha256)throw bad("Файл повреждён",409);
    const copied:DiskEntry={...original,id:randomUUID(),name:original.name,folder:target,uploadedAt:new Date().toISOString()};
    delete copied.deletedAt;
    await writeFile(this.file(copied.id),bytes,{flag:"wx",mode:0o600});
    this.entries.push(copied);
    try{await this.save();}catch(e){this.entries=this.entries.filter(x=>x.id!==copied.id);await rm(this.file(copied.id),{force:true});throw e;}
    return {...copied};
  }
  /** Roll back the latest file rename or move; each entry is bounded and persisted. */
  private fileActions:{id:string;before:{name:string;folder:string};after:{name:string;folder:string};at:string}[]=[];
  fileHistory(){return [...this.fileActions].reverse();}
  private logFileChange(e:DiskEntry,before:{name:string;folder:string}){
    this.fileActions.push({id:e.id,before,after:{name:e.name,folder:e.folder},at:new Date().toISOString()});
    if(this.fileActions.length>300)this.fileActions.shift();
  }
  async undoFileChange(){
    const record=this.fileActions.at(-1);
    if(!record)throw bad("Нет операций для отмены",404);
    const entry=this.entries.find(e=>e.id===record.id&&!e.deletedAt);
    if(!entry||entry.name!==record.after.name||entry.folder!==record.after.folder)throw bad("Файл изменился после операции",409);
    if(record.before.folder&&!this.folders.includes(record.before.folder))throw bad("Исходная папка больше не существует",409);
    entry.name=record.before.name;entry.folder=record.before.folder;
    this.fileActions.pop();await this.save();return {...entry};
  }
  async renameFile(id:string,name:unknown){
    const entry=this.entries.find(x=>x.id===id);
    if(!entry || entry.deletedAt)throw bad("Файл не найден",404);
    const next=validName(name);
    if(next===entry.name)return {...entry};
    const before={name:entry.name,folder:entry.folder};entry.name=next;this.logFileChange(entry,before);
    await this.save();
    return {...entry};
  }
  async toggleFavorite(id:string,favorite:unknown){
    const entry=this.entries.find(x=>x.id===id&&!x.deletedAt);
    if(!entry)throw bad("Файл не найден",404);
    if(typeof favorite!=="boolean")throw bad("Ожидается favorite: true или false");
    entry.favorite=favorite;
    await this.save();return {...entry};
  }
  async moveFile(id:string,folder:unknown){
    const entry=this.entries.find(x=>x.id===id&&!x.deletedAt);
    if(!entry)throw bad("Файл не найден",404);
    const next=validFolder(folder);
    if(next&&!this.folders.includes(next))throw bad("Папка не найдена",404);
    const before={name:entry.name,folder:entry.folder};entry.folder=next;this.logFileChange(entry,before);await this.save();return {...entry};
  }
  async restore(id:string){
    const entry=this.entries.find(x=>x.id===id&&x.deletedAt);
    if(!entry)throw bad("В корзине нет этого файла",404);
    if(entry.folder&&!this.folders.includes(entry.folder))entry.folder="";
    delete entry.deletedAt;
    await this.save();return {...entry};
  }
  async purge(id:string){
    const entry=this.entries.find(x=>x.id===id&&x.deletedAt);
    if(!entry)throw bad("В корзине нет этого файла",404);
    // Remove the object before deleting its index, so a failed filesystem operation remains retryable.
    await rm(this.file(id));
    this.entries=this.entries.filter(x=>x.id!==id);
    await this.save();return {ok:true};
  }
  /** Validate every target first, then persist one batch mutation. */
  async bulk(ids:unknown, action:unknown, folder?:unknown){
    if(!Array.isArray(ids)||!ids.length||ids.length>100||!ids.every(x=>typeof x==="string")||new Set(ids).size!==ids.length)
      throw bad("Выберите от 1 до 100 уникальных файлов");
    if(action!=="trash"&&action!=="restore"&&action!=="move"&&action!=="favorite"&&action!=="unfavorite")
      throw bad("Неизвестная пакетная операция");
    const destination=action==="move"?validFolder(folder):"";
    if(action==="move"&&destination&&!this.folders.includes(destination))throw bad("Папка не найдена",404);
    const entries=(ids as string[]).map(id=>this.entries.find(e=>e.id===id));
    if(entries.some(e=>!e))throw bad("Один из файлов не найден",404);
    for(const entry of entries){
      const e=entry!;
      if(action==="restore"?!e.deletedAt:!!e.deletedAt)throw bad("Файл имеет неподходящий статус для операции",409);
    }
    const now=new Date().toISOString();
    for(const entry of entries){
      const e=entry!;
      if(action==="trash")e.deletedAt=now;
      if(action==="restore"){delete e.deletedAt;if(e.folder&&!this.folders.includes(e.folder))e.folder="";}
      if(action==="move")e.folder=destination;
      if(action==="favorite")e.favorite=true;
      if(action==="unfavorite")e.favorite=false;
    }
    await this.save();
    return {updated:entries.length};
  }
  async remove(id:string){
    const e=this.entries.find(x=>x.id===id);
    if(!e)throw bad("Файл не найден",404);
    if(e.deletedAt)throw bad("Файл уже в корзине",409);
    e.deletedAt=new Date().toISOString();
    await this.save();
    return {ok:true};
  }
}
