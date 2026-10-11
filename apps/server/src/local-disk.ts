import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";

/** Local, owner-controlled vault. Files are never sent to a cloud service. */
export type DiskEntry = { id:string; name:string; folder:string; size:number; uploadedAt:string; sha256:string };
const LIMIT = 10 * 1024 * 1024;
const bad = (message:string,status=400)=>Object.assign(new Error(message),{status});
const validFolder = (name:unknown) => {
  if (typeof name!=="string" || name.length>80 || !/^[a-zA-Zа-яА-ЯёЁ0-9 _.-]*$/.test(name) || name==="." || name===".." || name.includes("..")) throw bad("Имя папки: до 80 букв или цифр, без пути");
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
  list(folder?:string){
    const f=folder===undefined?undefined:validFolder(folder);
    return {folders:[...this.folders].sort(),files:this.entries.filter(e=>f===undefined||e.folder===f).map(e=>({...e})).sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt)),usedBytes:this.entries.reduce((n,e)=>n+e.size,0),maxFileBytes:LIMIT};
  }
  async createFolder(name:unknown){
    const f=validFolder(name);
    if(!f)throw bad("Укажите название папки");
    if(this.folders.includes(f))throw bad("Такая папка уже есть",409);
    if(this.folders.length>=100)throw bad("Слишком много папок",409);
    this.folders.push(f);await this.save();return {name:f};
  }
  async upload(name:unknown,folder:unknown,data:unknown){
    const filename=validName(name), f=validFolder(folder);
    if(f&&!this.folders.includes(f))throw bad("Папка не найдена",404);
    if(typeof data!=="string"||data.length>Math.ceil(LIMIT*4/3)+8||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw bad("Некорректный файл или превышен лимит 10 МБ",413);
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
  async download(id:string){
    const entry=this.entries.find(x=>x.id===id);
    if(!entry)throw bad("Файл не найден",404);
    const data=await readFile(this.file(entry.id));
    if(createHash("sha256").update(data).digest("hex")!==entry.sha256)throw bad("Файл повреждён: контрольная сумма не совпадает",409);
    return {entry:{...entry},base64:data.toString("base64")};
  }
  async renameFile(id:string,name:unknown){
    const entry=this.entries.find(x=>x.id===id);
    if(!entry)throw bad("Файл не найден",404);
    const next=validName(name);
    if(next===entry.name)return {...entry};
    entry.name=next;
    await this.save();
    return {...entry};
  }
  async remove(id:string){
    const e=this.entries.find(x=>x.id===id);
    if(!e)throw bad("Файл не найден",404);
    this.entries=this.entries.filter(x=>x.id!==id);
    await this.save();
    await rm(this.file(e.id),{force:true});
    return {ok:true};
  }
}
