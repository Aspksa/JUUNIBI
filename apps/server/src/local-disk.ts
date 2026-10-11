import { diskChronicles } from "./disk-chronicles";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";

/** Local, owner-controlled vault. Files are never sent to a cloud service. */
export type DiskEntry = { id:string; name:string; folder:string; size:number; uploadedAt:string; sha256:string; favorite?:boolean; deletedAt?:string };
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
  private writes:Promise<void>=Promise.resolve();
  constructor(private readonly root:string) {}
  private get index(){return path.join(this.root,"index.json");}
  private file(id:string){return path.join(this.root,"objects",id);}
  async load(){
    try {
      const raw=JSON.parse(await readFile(this.index,"utf8")) as {entries?:DiskEntry[];folders?:string[]};
      if(Array.isArray(raw.entries)) this.entries=raw.entries.filter(x=>!!x&&typeof x.id==="string"&&/^[0-9a-f-]{36}$/.test(x.id)&&typeof x.name==="string"&&typeof x.folder==="string"&&Number.isSafeInteger(x.size)&&typeof x.sha256==="string");
      if(Array.isArray(raw.folders)) this.folders=raw.folders.filter(x=>{try{return validFolder(x)===x&&!!x;}catch{return false;}});
    }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
  private save(){
    const content=JSON.stringify({entries:this.entries,folders:this.folders});
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
    this.folders.push(f);await this.save();return {name:f};
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
  async renameFile(id:string,name:unknown){
    const entry=this.entries.find(x=>x.id===id);
    if(!entry || entry.deletedAt)throw bad("Файл не найден",404);
    const next=validName(name);
    if(next===entry.name)return {...entry};
    entry.name=next;
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
    entry.folder=next;await this.save();return {...entry};
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
