import { diskChronicles } from "./disk-chronicles";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { inflateSync } from "node:zlib";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";

/** Local, owner-controlled vault. Files are never sent to a cloud service. */
export type DiskEntry = { id:string; name:string; folder:string; size:number; uploadedAt:string; sha256:string; favorite?:boolean; deletedAt?:string; tags?:string[]; color?:string; note?:string; objectId?:string; revision?:number };
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
type DiskRevision = {revision:number;objectId:string;size:number;sha256:string;at:string};
export class LocalDisk {
  private entries:DiskEntry[]=[];
  private versions:Record<string,DiskRevision[]>={};
  private folders:string[]=[];
  private folderStyles:Record<string,{color:string;pinned:boolean;cover:string;createdAt?:string}>={};
  private folderActions:{at:string;action:string;folder:string;destination?:string;files?:number}[]=[];
  private logFolder(action:string,folder:string,destination?:string,files?:number){this.folderActions.push({at:new Date().toISOString(),action,folder,...(destination===undefined?{}:{destination}),...(files===undefined?{}:{files})});if(this.folderActions.length>300)this.folderActions.shift();}
  folderHistory(){return [...this.folderActions].reverse();}
  private deletedFolders:{root:string;paths:string[];at:string;styles:Record<string,{color:string;pinned:boolean;cover:string}>}[]=[];
  private writes:Promise<void>=Promise.resolve();
  /** Days a file stays in the trash before it is removed for good; 0 keeps it until the owner empties the trash. */
  private trashDays=30;
  private mutations:Promise<void>=Promise.resolve();
  private async acquireMutation(){
    const previous=this.mutations;
    let release!:()=>void;
    this.mutations=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    return release;
  }
  private state(){return structuredClone({entries:this.entries,versions:this.versions,folders:this.folders,folderStyles:this.folderStyles,folderActions:this.folderActions,fileActions:this.fileActions,deletedFolders:this.deletedFolders,trashDays:this.trashDays});}
  /** Serialize whole operations, including streamed input, and restore rejected in-memory edits. */
  private async mutate<T>(operation:()=>Promise<T>):Promise<T>{
    const release=await this.acquireMutation();
    try{
      const before=this.state();
      try{return await operation();}catch(error){Object.assign(this,before);throw error;}
    }finally{release();}
  }
  constructor(private readonly root:string) {}

  importBackup(lines:AsyncIterable<string>) { return this.mutate(() => this.importBackupUnlocked(lines)); }
  createFolder(name:unknown) { return this.mutate(() => this.createFolderUnlocked(name)); }
  renameFolder(oldName:unknown,newName:unknown) { return this.mutate(() => this.renameFolderUnlocked(oldName,newName)); }
  moveFolder(from:unknown,parent:unknown) { return this.mutate(() => this.moveFolderUnlocked(from,parent)); }
  setFolderStyle(name:unknown,color:unknown,pinned:unknown,cover:unknown) { return this.mutate(() => this.setFolderStyleUnlocked(name,color,pinned,cover)); }
  copyFolder(source:unknown,parent:unknown) { return this.mutate(() => this.copyFolderUnlocked(source,parent)); }
  restoreFolder(name:unknown) { return this.mutate(() => this.restoreFolderUnlocked(name)); }
  trashFolder(name:unknown) { return this.mutate(() => this.trashFolderUnlocked(name)); }
  upload(name:unknown,folder:unknown,data:unknown) { return this.mutate(() => this.uploadUnlocked(name,folder,data)); }
  uploadStream(name:unknown,folder:unknown,stream:AsyncIterable<Buffer>) { return this.mutate(() => this.uploadStreamUnlocked(name,folder,stream)); }
  uploadBytes(name:unknown,folder:unknown,buf:Buffer) { return this.mutate(() => this.uploadBytesUnlocked(name,folder,buf)); }
  setMetadata(id:string,input:{tags?:unknown;color?:unknown;note?:unknown}) { return this.mutate(() => this.setMetadataUnlocked(id,input)); }
  syncFolders(from:unknown,to:unknown,apply:unknown=false) { return this.mutate(() => this.syncFoldersUnlocked(from,to,apply)); }
  copyFile(id:string,folder:unknown) { return this.mutate(() => this.copyFileUnlocked(id,folder)); }
  undoFileChange() { return this.mutate(() => this.undoFileChangeUnlocked()); }
  replaceStream(id:string,stream:AsyncIterable<Buffer>,expectedSha256?:unknown) { return this.mutate(() => this.replaceStreamUnlocked(id,stream,expectedSha256)); }
  restoreFileVersion(id:string,revision:unknown) { return this.mutate(() => this.restoreFileVersionUnlocked(id,revision)); }
  renameFile(id:string,name:unknown) { return this.mutate(() => this.renameFileUnlocked(id,name)); }
  toggleFavorite(id:string,favorite:unknown) { return this.mutate(() => this.toggleFavoriteUnlocked(id,favorite)); }
  moveFile(id:string,folder:unknown) { return this.mutate(() => this.moveFileUnlocked(id,folder)); }
  restore(id:string) { return this.mutate(() => this.restoreUnlocked(id)); }
  purge(id:string) { return this.mutate(() => this.purgeUnlocked(id)); }
  bulk(ids:unknown, action:unknown, folder?:unknown) { return this.mutate(() => this.bulkUnlocked(ids,action,folder)); }
  remove(id:string) { return this.mutate(() => this.removeUnlocked(id)); }
  setTrashDays(days:unknown) { return this.mutate(() => this.setTrashDaysUnlocked(days)); }
  emptyTrash(olderThanMs?:number,now=Date.now()) { return this.mutate(() => this.emptyTrashUnlocked(olderThanMs,now)); }

  private get index(){return path.join(this.root,"index.json");}
  private objectPath(id:string){return path.join(this.root,"objects",id);}
  private file(id:string){const entry=this.entries.find(e=>e.id===id);return this.objectPath(entry?.objectId??id);}
  async load(){
    const before=this.state();
    try {
      const raw=JSON.parse(await readFile(this.index,"utf8")) as {versions?:Record<string,DiskRevision[]>;entries?:DiskEntry[];folders?:string[];folderStyles?:Record<string,{color:string;pinned:boolean;cover:string}>;folderActions?:{at:string;action:string;folder:string;destination?:string;files?:number}[];fileActions?:{id:string;before:{name:string;folder:string};after:{name:string;folder:string};at:string}[];deletedFolders?:{root:string;paths:string[];at:string;styles:Record<string,{color:string;pinned:boolean;cover:string}>}[];trashDays?:number};
      if(raw.versions&&typeof raw.versions==="object")this.versions=raw.versions;
      if(Array.isArray(raw.entries)) this.entries=raw.entries.filter(x=>!!x&&typeof x.id==="string"&&/^[0-9a-f-]{36}$/.test(x.id)&&typeof x.name==="string"&&typeof x.folder==="string"&&Number.isSafeInteger(x.size)&&typeof x.sha256==="string");
      if(raw.folderStyles&&typeof raw.folderStyles==="object")this.folderStyles=raw.folderStyles;
      if(Array.isArray(raw.fileActions))this.fileActions=raw.fileActions.slice(-300);
      if(Array.isArray(raw.folderActions))this.folderActions=raw.folderActions.slice(-300);
      if(Array.isArray(raw.deletedFolders))this.deletedFolders=raw.deletedFolders;
      if(Number.isInteger(raw.trashDays)&&raw.trashDays!>=0&&raw.trashDays!<=365)this.trashDays=raw.trashDays!;
      if(Array.isArray(raw.folders)) this.folders=raw.folders.filter(x=>{try{return validFolder(x)===x&&!!x;}catch{return false;}});
    }catch(e){Object.assign(this,before);if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
  private save(){
    const content=JSON.stringify({versions:this.versions,entries:this.entries,folders:this.folders,folderStyles:this.folderStyles,folderActions:this.folderActions,fileActions:this.fileActions,deletedFolders:this.deletedFolders,trashDays:this.trashDays});
    this.writes=this.writes.catch(()=>{}).then(async()=>{
      await mkdir(this.root,{recursive:true});
      const tmp=path.join(this.root,randomUUID()+".tmp");
      await writeFile(tmp,content,{mode:0o600});
      await rename(tmp,this.index);
    });
    return this.writes;
  }

  /** Portable newline-delimited archive: immutable object checksums are verified on both sides. */
  async *exportBackup():AsyncGenerator<string>{
    const release=await this.acquireMutation();
    try{yield* this.exportBackupUnlocked();}finally{release();}
  }
  private async *exportBackupUnlocked():AsyncGenerator<string>{
    const state={
      entries:this.entries.map(e=>({...e})),
      versions:JSON.parse(JSON.stringify(this.versions)) as Record<string,DiskRevision[]>,
      folders:[...this.folders],folderStyles:{...this.folderStyles},
      deletedFolders:this.deletedFolders.map(d=>({...d})),
      folderActions:this.folderActions.map(a=>({...a})),fileActions:this.fileActions.map(a=>({...a})),
      trashDays:this.trashDays
    };
    yield JSON.stringify({type:"manifest",format:1,state})+"\n";
    const objects=new Map<string,{size:number;sha256:string}>();
    for(const e of state.entries)objects.set(e.objectId??e.id,{size:e.size,sha256:e.sha256});
    for(const history of Object.values(state.versions))for(const v of history)objects.set(v.objectId,{size:v.size,sha256:v.sha256});
    let count=0;
    for(const [id,expected] of objects){
      if(!/^[0-9a-f-]{36}$/.test(id))throw bad("Недопустимый объект архива",409);
      yield JSON.stringify({type:"object",id,...expected})+"\n";
      const hash=createHash("sha256");let size=0;
      for await(const chunk of createReadStream(this.objectPath(id),{highWaterMark:256*1024})){
        const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        size+=buf.length;hash.update(buf);
        yield JSON.stringify({type:"chunk",data:buf.toString("base64")})+"\n";
      }
      if(size!==expected.size||hash.digest("hex")!==expected.sha256)throw bad("Файл изменён или повреждён во время резервирования",409);
      yield '{"type":"end"}\n';count++;
    }
    yield JSON.stringify({type:"complete",objects:count})+"\n";
  }
  /** Restore only to an empty vault; validate all bytes before committing the new index. */
  private async importBackupUnlocked(lines:AsyncIterable<string>){
    if(this.entries.length||this.folders.length||Object.keys(this.versions).length)throw bad("Для восстановления требуется пустой Диск",409);
    const staged:string[]=[];const verified=new Map<string,{size:number;sha256:string}>();let committed=false;let manifest:unknown=null;let active:{id:string;size:number;sha256:string;bytes:number;hash:ReturnType<typeof createHash>;handle:Awaited<ReturnType<typeof open>>}|null=null;
    let count=0,complete=false;
    await mkdir(path.join(this.root,"objects"),{recursive:true});
    try{
      for await(const line of lines){
        if(line.length>17*1024*1024)throw bad("Превышен допустимый размер строки архива",413);
        const rec=JSON.parse(line) as Record<string,unknown>;
        if(!manifest){
          if(rec.type!=="manifest"||rec.format!==1||typeof rec.state!=="object"||!rec.state)throw bad("Неверный формат архива");
          manifest=rec.state;continue;
        }
        if(complete)throw bad("Данные после конца архива");
        if(rec.type==="object"&&!active){
          if(typeof rec.id!=="string"||!/^[0-9a-f-]{36}$/.test(rec.id)||!Number.isSafeInteger(rec.size)||Number(rec.size)>LIMIT||Number(rec.size)<0||typeof rec.sha256!=="string"||!/^[a-f0-9]{64}$/.test(rec.sha256))throw bad("Неверная запись файла в архиве");
          if(staged.includes(rec.id))throw bad("Повторный объект архива");
          const handle=await open(this.objectPath(rec.id),"wx",0o600);
          staged.push(rec.id);active={id:rec.id,size:Number(rec.size),sha256:rec.sha256,bytes:0,hash:createHash("sha256"),handle};continue;
        }
        if(rec.type==="chunk"&&active){
          if(typeof rec.data!=="string"||rec.data.length>800000||!/^([a-zA-Z0-9+/]*={0,2})$/.test(rec.data))throw bad("Неверный блок данных архива");
          const buf=Buffer.from(rec.data,"base64");
          active.bytes+=buf.length;if(active.bytes>active.size)throw bad("Размер файла не совпадает с архивом");
          active.hash.update(buf);await active.handle.writeFile(buf);continue;
        }
        if(rec.type==="end"&&active){
          const item=active;active=null;await item.handle.close();
          if(item.bytes!==item.size||item.hash.digest("hex")!==item.sha256)throw bad("Контрольная сумма резервного файла не совпадает",409);
          verified.set(item.id,{size:item.size,sha256:item.sha256});count++;continue;
        }
        if(rec.type==="complete"&&!active&&Number.isSafeInteger(rec.objects)&&rec.objects===count){complete=true;continue;}
        throw bad("Повреждённая последовательность архива");
      }
      if(!complete||active)throw bad("Неполная резервная копия",409);
      const state=manifest as Record<string,unknown>;
      if(!Array.isArray(state.entries)||!Array.isArray(state.folders)||typeof state.versions!=="object"||!state.versions)throw bad("Неверный индекс архива");
      if(state.entries.length>1000||state.folders.length>100)throw bad("Архив превышает лимиты хранилища",409);
      const entries=state.entries as DiskEntry[];
      const versions=state.versions as Record<string,DiskRevision[]>;
      const folders=state.folders as string[];
      const deletedFolders=Array.isArray(state.deletedFolders)?state.deletedFolders as typeof this.deletedFolders:[];
      const deletedPaths=new Set<string>();
      for(const item of deletedFolders){
        if(!item||!item.root||validFolder(item.root)!==item.root||!Array.isArray(item.paths)||!item.paths.includes(item.root)||typeof item.at!=="string"||!Number.isFinite(Date.parse(item.at)))throw bad("Некорректная удалённая папка",409);
        for(const folder of item.paths){
          if(!folder||validFolder(folder)!==folder||(folder!==item.root&&!folder.startsWith(item.root+"/")))throw bad("Некорректный путь удалённой папки",409);
          deletedPaths.add(folder);
        }
      }
      const referenced=new Set<string>();
      const entryIds=new Set<string>();
      for(const e of entries){
        validName(e.name);validFolder(e.folder);
        if(typeof e.id!=="string"||!/^[0-9a-f-]{36}$/.test(e.id)||!Number.isSafeInteger(e.size)||e.size<0||e.size>LIMIT||!/^[0-9a-f]{64}$/.test(e.sha256))throw bad("Некорректный файл в индексе");
        if(entryIds.has(e.id))throw bad("Повторный идентификатор файла",409);
        entryIds.add(e.id);
        if(e.folder&&!folders.includes(e.folder)&&!(e.deletedAt&&deletedPaths.has(e.folder)))throw bad("Отсутствует каталог файла",409);
        const object=verified.get(e.objectId??e.id);
        if(!object||object.size!==e.size||object.sha256!==e.sha256)throw bad("Индекс не совпадает с содержимым файла",409);
        referenced.add(e.objectId??e.id);
        const seenRevisions=new Set<number>();
        for(const v of versions[e.id]??[]){
          if(!Number.isSafeInteger(v.revision)||v.revision<1||seenRevisions.has(v.revision))throw bad("Некорректная история версий",409);
          seenRevisions.add(v.revision);
          const previous=verified.get(v.objectId);
          if(!previous||previous.size!==v.size||previous.sha256!==v.sha256)throw bad("Индекс не совпадает с архивной редакцией",409);
          referenced.add(v.objectId);
        }
      }
      if(referenced.size!==count||[...referenced].some(id=>!staged.includes(id)))throw bad("Архив не содержит все объекты индекса",409);
      for(const folder of folders)if(!folder||validFolder(folder)!==folder)throw bad("Некорректная папка архива");
      this.entries=entries;this.folders=folders;this.versions=versions;
      this.folderStyles=(state.folderStyles??{}) as typeof this.folderStyles;
      this.deletedFolders=deletedFolders;
      if(state.trashDays!==undefined){if(!Number.isInteger(state.trashDays)||Number(state.trashDays)<0||Number(state.trashDays)>365)throw bad("Некорректный срок хранения корзины",409);this.trashDays=Number(state.trashDays);}
      this.folderActions=Array.isArray(state.folderActions)?state.folderActions as typeof this.folderActions:[];
      this.fileActions=Array.isArray(state.fileActions)?state.fileActions as typeof this.fileActions:[];
      await this.save();committed=true;
      return {files:entries.length,folders:folders.length,objects:count};
    }catch(e){
      if(active)await active.handle.close().catch(()=>{});
      if(!committed){
        this.entries=[];this.versions={};this.folders=[];this.folderStyles={};this.deletedFolders=[];this.folderActions=[];this.fileActions=[];
        for(const id of staged)await rm(this.objectPath(id),{force:true});
      }
      throw e;
    }
  }
  chronicles(){return diskChronicles(this.entries,this.folders);}
  list(folder?:string){
    const f=folder===undefined?undefined:validFolder(folder);
    return {folders:[...this.folders].sort(),files:this.entries.filter(e=>!e.deletedAt&&(f===undefined||e.folder===f)).map(e=>({...e})).sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt)),trash:this.entries.filter(e=>!!e.deletedAt).map(e=>({...e})).sort((a,b)=>(b.deletedAt??"").localeCompare(a.deletedAt??"")),usedBytes:this.entries.reduce((n,e)=>n+e.size,0)+Object.values(this.versions).flat().reduce((n,v)=>n+v.size,0),maxFileBytes:LIMIT};
  }
  private async createFolderUnlocked(name:unknown){
    const f=validFolder(name);
    if(!f)throw bad("Укажите название папки");
    if(this.folders.includes(f))throw bad("Такая папка уже есть",409);
    const parent=f.includes("/")?f.slice(0,f.lastIndexOf("/")):"";
    if(parent&&!this.folders.includes(parent))throw bad("Сначала создайте родительскую папку",404);
    if(this.folders.length>=100)throw bad("Слишком много папок",409);
    this.folders.push(f);this.folderStyles[f]={color:"#b89cff",pinned:false,cover:"",createdAt:new Date().toISOString()};this.logFolder("create",f);await this.save();return {name:f};
  }
  private async renameFolderUnlocked(oldName:unknown,newName:unknown){
    const from=validFolder(oldName),to=validFolder(newName);
    if(!from||!to||!this.folders.includes(from))throw bad("Папка не найдена",404);
    if(from===to)return {name:from};
    if(to.startsWith(from+"/"))throw bad("Нельзя перенести папку внутрь себя");
    const parent=to.includes("/")?to.slice(0,to.lastIndexOf("/")):"";
    if(parent&&!this.folders.includes(parent))throw bad("Родительская папка не найдена",404);
    const affected=this.folders.filter(f=>f===from||f.startsWith(from+"/"));
    const renamed=(f:string)=>to+f.slice(from.length);
    for(const f of affected)validFolder(renamed(f));
    if(this.folders.some(f=>!affected.includes(f)&&affected.some(a=>renamed(a)===f)))throw bad("Папка с таким именем уже существует",409);
    this.folders=this.folders.map(f=>affected.includes(f)?renamed(f):f);
    for(const f of affected){if(this.folderStyles[f]){this.folderStyles[renamed(f)]=this.folderStyles[f]!;delete this.folderStyles[f];}}
    for(const entry of this.entries)if(entry.folder===from||entry.folder.startsWith(from+"/"))entry.folder=renamed(entry.folder);
    this.logFolder("rename",from,to);await this.save();return {name:to};
  }
  /** Move an entire branch, reusing collision checks in renameFolder. */
  private async moveFolderUnlocked(from:unknown,parent:unknown){
    const src=validFolder(from),dest=validFolder(parent);
    if(!src||!this.folders.includes(src))throw bad("Папка не найдена",404);
    if(dest&&!this.folders.includes(dest))throw bad("Папка назначения не найдена",404);
    return this.renameFolderUnlocked(src,(dest?dest+"/":"")+src.split("/").pop()!);
  }
  private async setFolderStyleUnlocked(name:unknown,color:unknown,pinned:unknown,cover:unknown){
    const folder=validFolder(name);
    if(!this.folders.includes(folder))throw bad("Папка не найдена",404);
    if(typeof color!=="string"||!/^#[0-9a-fA-F]{6}$/.test(color))throw bad("Неверный цвет");
    if(typeof pinned!=="boolean")throw bad("Неверное значение закрепления");
    if(typeof cover!=="string"||cover.length>100)throw bad("Неверная обложка");
    if(cover&&!this.entries.some(e=>e.id===cover&&!e.deletedAt&&e.folder===folder&&/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(e.name)))throw bad("Выберите изображение из этой папки",400);
    this.folderStyles[folder]={color,pinned,cover,...(this.folderStyles[folder]?.createdAt?{createdAt:this.folderStyles[folder]!.createdAt}:{})};
    this.logFolder("style",folder);await this.save();return {name:folder,...this.folderStyles[folder]};
  }
  folderDecorations(){return {...this.folderStyles};}
  private async copyFolderUnlocked(source:unknown,parent:unknown){
    const from=validFolder(source),toParent=validFolder(parent);
    if(!from||!this.folders.includes(from))throw bad("Папка не найдена",404);
    if(toParent&&!this.folders.includes(toParent))throw bad("Папка назначения не найдена",404);
    const prefix=toParent?toParent+"/":"",base=from.split("/").pop()!;
    const copyName=(number:number)=>{const suffix=" - копия"+(number===1?"":" "+number);return prefix+base.slice(0,80-suffix.length).trimEnd()+suffix;};
    let target=copyName(1),number=2;
    while(this.folders.includes(target)){target=copyName(number++);if(number>1000)throw bad("Нельзя выбрать имя копии",409);}
    const folders=this.folders.filter(f=>f===from||f.startsWith(from+"/"));
    for(const folder of folders)validFolder(target+folder.slice(from.length));
    const entries=this.entries.filter(e=>!e.deletedAt&&(e.folder===from||e.folder.startsWith(from+"/")));
    if(this.folders.length+folders.length>100||this.entries.length+entries.length>1000)throw bad("Превышен лимит хранилища",409);
    const copied:string[]=[];
    try{
      for(const e of entries){
        const bytes=await readFile(this.file(e.id));
        if(createHash("sha256").update(bytes).digest("hex")!==e.sha256)throw bad("Повреждён исходный файл",409);
        const id=randomUUID();await writeFile(this.objectPath(id),bytes,{flag:"wx",mode:0o600});
        copied.push(id);
      }
    }catch(e){for(const id of copied)await rm(this.file(id),{force:true});throw e;}
    this.folders.push(...folders.map(f=>target+f.slice(from.length)));
    const copiedIds=new Map(entries.map((e,i)=>[e.id,copied[i]!]));
    for(const folder of folders){
      const style=this.folderStyles[folder]??{color:"#b89cff",pinned:false,cover:""};
      this.folderStyles[target+folder.slice(from.length)]={...style,cover:copiedIds.get(style.cover)??"",createdAt:new Date().toISOString()};
    }
    this.entries.push(...entries.map((e,i)=>{const copy={...e,id:copied[i]!,folder:target+e.folder.slice(from.length),uploadedAt:new Date().toISOString(),revision:1};delete copy.objectId;return copy;}));
    this.logFolder("copy",from,target,copied.length);await this.save();return {name:target,files:copied.length};
  }
  listDeletedFolders(){return this.deletedFolders.map(({root,paths,at})=>({root,count:paths.length,at}));}
  private async restoreFolderUnlocked(name:unknown){
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
  private async trashFolderUnlocked(name:unknown){
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
  private async uploadUnlocked(name:unknown,folder:unknown,data:unknown){
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
  private async uploadStreamUnlocked(name:unknown,folder:unknown,stream:AsyncIterable<Buffer>){
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
  private async uploadBytesUnlocked(name:unknown,folder:unknown,buf:Buffer){
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
    const revisionIssues:{fileId:string;revision:number;status:"missing"|"corrupt"}[]=[];
    let revisionsChecked=0;
    for(const [fileId,history] of Object.entries(this.versions)){
      for(const v of history){
        revisionsChecked++;
        try{
          const bytes=await readFile(this.objectPath(v.objectId));
          if(bytes.length!==v.size||createHash("sha256").update(bytes).digest("hex")!==v.sha256)
            revisionIssues.push({fileId,revision:v.revision,status:"corrupt"});
        }catch{revisionIssues.push({fileId,revision:v.revision,status:"missing"});}
      }
    }
    return {total:results.length,ok:results.filter(x=>x.status==="ok").length,results,revisionsChecked,revisionIssues};
  }
  duplicates(){
    const groups=new Map<string,DiskEntry[]>();
    for(const e of this.entries.filter(x=>!x.deletedAt)){
      const key=e.sha256+":"+e.size,group=groups.get(key)??[];
      group.push({...e});groups.set(key,group);
    }
    return [...groups.values()].filter(group=>group.length>1);
  }
  private async setMetadataUnlocked(id:string,input:{tags?:unknown;color?:unknown;note?:unknown}){
    const e=this.entries.find(x=>x.id===id&&!x.deletedAt);
    if(!e)throw bad("Файл не найден",404);
    if(input.tags!==undefined){
      if(!Array.isArray(input.tags)||input.tags.length>12||input.tags.some(t=>typeof t!=="string"||t.length>32||!t.trim()))throw bad("Не более 12 тегов по 32 символа");
      e.tags=[...new Set((input.tags as string[]).map(t=>t.trim()))];
    }
    if(input.color!==undefined){
      if(typeof input.color!=="string"||(input.color&&!/^#[0-9a-fA-F]{6}$/.test(input.color)))throw bad("Недопустимый цвет");
      if(input.color)e.color=input.color;else delete e.color;
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
  /** Sync two local folders without ever overwriting a conflicting filename. */
  private async syncFoldersUnlocked(from:unknown,to:unknown,apply:unknown=false){
    const source=validFolder(from),target=validFolder(to);
    if(source===target)throw bad("Нельзя синхронизировать папку саму с собой");
    if(source&&!this.folders.includes(source))throw bad("Исходная папка не найдена",404);
    if(target&&!this.folders.includes(target))throw bad("Папка назначения не найдена",404);
    if(typeof apply!=="boolean")throw bad("Недопустимый режим синхронизации");
    const originals=this.entries.filter(e=>!e.deletedAt&&e.folder===source);
    const incoming=this.entries.filter(e=>!e.deletedAt&&e.folder===target);
    const candidate:DiskEntry[]=[],conflicts:{name:string;reason:string}[]=[];
    let unchanged=0;
    const seen=new Set<string>();
    for(const entry of originals){
      const key=entry.name.toLocaleLowerCase();
      if(seen.has(key)){conflicts.push({name:entry.name,reason:"Повторяющееся имя в источнике"});continue;}
      seen.add(key);
      const matches=incoming.filter(e=>e.name.toLocaleLowerCase()===key);
      if(matches.some(e=>e.sha256===entry.sha256&&e.size===entry.size)){unchanged++;continue;}
      if(matches.length){conflicts.push({name:entry.name,reason:"Различается содержимое"});continue;}
      candidate.push(entry);
    }
    if(!apply)return {copied:0,pending:candidate.length,unchanged,conflicts};
    if(conflicts.length)throw bad("Обнаружены конфликты. Синхронизация отменена",409);
    if(this.entries.length+candidate.length>1000)throw bad("Недостаточно свободных слотов в хранилище",409);
    const written:string[]=[];const copied:DiskEntry[]=[];
    try{
      for(const e of candidate){
        const bytes=await readFile(this.file(e.id));
        if(bytes.length!==e.size||createHash("sha256").update(bytes).digest("hex")!==e.sha256)throw bad("Исходный файл повреждён",409);
        const id=randomUUID();
        await writeFile(this.objectPath(id),bytes,{flag:"wx",mode:0o600});
        written.push(id);
        const copy:DiskEntry={...e,id,folder:target,revision:1,uploadedAt:new Date().toISOString()};
        delete copy.objectId;delete copy.deletedAt;
        copied.push(copy);
      }
      this.entries.push(...copied);
      await this.save();
    }catch(e){
      this.entries=this.entries.filter(e=>!written.includes(e.id));
      for(const id of written)await rm(this.objectPath(id),{force:true});
      throw e;
    }
    return {copied:copied.length,pending:0,unchanged,conflicts};
  }
  private async copyFileUnlocked(id:string,folder:unknown){
    const original=this.entries.find(e=>e.id===id&&!e.deletedAt);
    if(!original)throw bad("Файл не найден",404);
    const target=validFolder(folder);
    if(target&&!this.folders.includes(target))throw bad("Папка назначения не найдена",404);
    if(this.entries.length>=1000)throw bad("Достигнут лимит 1000 файлов",409);
    const bytes=await readFile(this.file(id));
    if(bytes.length!==original.size||createHash("sha256").update(bytes).digest("hex")!==original.sha256)throw bad("Файл повреждён",409);
    const copied:DiskEntry={...original,id:randomUUID(),name:original.name,folder:target,uploadedAt:new Date().toISOString()};
    delete copied.deletedAt;
    delete copied.objectId;
    copied.revision=1;
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
  private async undoFileChangeUnlocked(){
    const record=this.fileActions.at(-1);
    if(!record)throw bad("Нет операций для отмены",404);
    const entry=this.entries.find(e=>e.id===record.id&&!e.deletedAt);
    if(!entry||entry.name!==record.after.name||entry.folder!==record.after.folder)throw bad("Файл изменился после операции",409);
    if(record.before.folder&&!this.folders.includes(record.before.folder))throw bad("Исходная папка больше не существует",409);
    entry.name=record.before.name;entry.folder=record.before.folder;
    this.fileActions.pop();await this.save();return {...entry};
  }
  /** Immutable file revisions. Existing bytes remain intact until index persistence succeeds. */
  fileVersions(id:string){
    const entry=this.entries.find(e=>e.id===id&&!e.deletedAt);
    if(!entry)throw bad("Файл не найден",404);
    return [...(this.versions[id]??[]).map(({revision,size,sha256,at})=>({revision,size,sha256,at})),
      {revision:entry.revision??1,size:entry.size,sha256:entry.sha256,at:entry.uploadedAt}];
  }
  private async replaceStreamUnlocked(id:string,stream:AsyncIterable<Buffer>,expectedSha256?:unknown){
    const entry=this.entries.find(e=>e.id===id&&!e.deletedAt);
    if(!entry)throw bad("Файл не найден",404);
    if(typeof expectedSha256!=="string"||expectedSha256!==entry.sha256)throw bad("Файл изменился: обновите список перед заменой",409);
    if((this.versions[id]?.length??0)>=20)throw bad("Лимит 20 сохранённых редакций для файла",409);
    const nextObject=randomUUID(),temp=this.objectPath(nextObject)+".part";
    const handle=await open(temp,"wx",0o600);
    let size=0;const hash=createHash("sha256");
    try{
      for await(const chunk of stream){
        size+=chunk.length;if(size>LIMIT)throw bad("Превышен лимит 50 МБ",413);
        hash.update(chunk);let off=0;
        while(off<chunk.length){const wrote=await handle.write(chunk,off,chunk.length-off,null);if(!wrote.bytesWritten)throw new Error("Невозможно записать файл");off+=wrote.bytesWritten;}
      }
      if(!size)throw bad("Пустая редакция недопустима",413);
    }catch(e){await handle.close();await rm(temp,{force:true});throw e;}
    await handle.close();
    await rename(temp,this.objectPath(nextObject));
    const old={...entry};
    const oldHistory=[...(this.versions[id]??[])];
    this.versions[id]=[...oldHistory,{revision:old.revision??1,objectId:old.objectId??old.id,size:old.size,sha256:old.sha256,at:old.uploadedAt}];
    entry.objectId=nextObject;entry.revision=(old.revision??1)+1;
    entry.size=size;entry.sha256=hash.digest("hex");entry.uploadedAt=new Date().toISOString();
    try{await this.save();}catch(e){Object.assign(entry,old);this.versions[id]=oldHistory;await rm(this.objectPath(nextObject),{force:true});throw e;}
    return {...entry};
  }
  private async restoreFileVersionUnlocked(id:string,revision:unknown){
    const entry=this.entries.find(e=>e.id===id&&!e.deletedAt);
    if(!entry)throw bad("Файл не найден",404);
    if(!Number.isSafeInteger(revision))throw bad("Недопустимый номер редакции");
    const past=(this.versions[id]??[]).find(v=>v.revision===revision);
    if(!past)throw bad("Редакция не найдена",404);
    const data=await readFile(this.objectPath(past.objectId));
    if(data.length!==past.size||createHash("sha256").update(data).digest("hex")!==past.sha256)throw bad("Архивная редакция повреждена",409);
    return this.replaceStreamUnlocked(id,(async function*(){yield data;})(),entry.sha256);
  }
  private async renameFileUnlocked(id:string,name:unknown){
    const entry=this.entries.find(x=>x.id===id);
    if(!entry || entry.deletedAt)throw bad("Файл не найден",404);
    const next=validName(name);
    if(next===entry.name)return {...entry};
    const before={name:entry.name,folder:entry.folder};entry.name=next;this.logFileChange(entry,before);
    await this.save();
    return {...entry};
  }
  private async toggleFavoriteUnlocked(id:string,favorite:unknown){
    const entry=this.entries.find(x=>x.id===id&&!x.deletedAt);
    if(!entry)throw bad("Файл не найден",404);
    if(typeof favorite!=="boolean")throw bad("Ожидается favorite: true или false");
    entry.favorite=favorite;
    await this.save();return {...entry};
  }
  private async moveFileUnlocked(id:string,folder:unknown){
    const entry=this.entries.find(x=>x.id===id&&!x.deletedAt);
    if(!entry)throw bad("Файл не найден",404);
    const next=validFolder(folder);
    if(next&&!this.folders.includes(next))throw bad("Папка не найдена",404);
    const before={name:entry.name,folder:entry.folder};entry.folder=next;this.logFileChange(entry,before);await this.save();return {...entry};
  }
  private async restoreUnlocked(id:string){
    const entry=this.entries.find(x=>x.id===id&&x.deletedAt);
    if(!entry)throw bad("В корзине нет этого файла",404);
    if(entry.folder&&!this.folders.includes(entry.folder))entry.folder="";
    delete entry.deletedAt;
    await this.save();return {...entry};
  }
  private async purgeUnlocked(id:string){
    const entry=this.entries.find(x=>x.id===id&&x.deletedAt);
    if(!entry)throw bad("В корзине нет этого файла",404);
    const objects=[entry.objectId??entry.id,...(this.versions[id]??[]).map(v=>v.objectId)];
    delete this.versions[id];
    this.entries=this.entries.filter(x=>x.id!==id);
    // Persist removal before deleting bytes: failed saves must never resurrect missing objects.
    await this.save();
    for(const object of objects)await rm(this.objectPath(object),{force:true}).catch(()=>{});
    return {ok:true};
  }
  /** Validate every target first, then persist one batch mutation. */
  private async bulkUnlocked(ids:unknown, action:unknown, folder?:unknown){
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
  private async removeUnlocked(id:string){
    const e=this.entries.find(x=>x.id===id);
    if(!e)throw bad("Файл не найден",404);
    if(e.deletedAt)throw bad("Файл уже в корзине",409);
    e.deletedAt=new Date().toISOString();
    await this.save();
    return {ok:true};
  }
  /** Where the bytes of an active file live, for streaming previews and downloads without base64. */
  rawFile(id:string){
    const entry=this.entries.find(x=>x.id===id&&!x.deletedAt);
    if(!entry)throw bad("Файл не найден",404);
    return {entry:{...entry},path:this.file(id)};
  }
  /** Other active files with exactly the same bytes: the upload warning names where the twin already is. */
  sameContent(id:string){
    const entry=this.entries.find(x=>x.id===id);
    if(!entry)return [];
    return this.entries.filter(x=>x.id!==id&&!x.deletedAt&&x.sha256===entry.sha256&&x.size===entry.size).map(x=>({id:x.id,name:x.name,folder:x.folder}));
  }
  trashSettings(){return {days:this.trashDays};}
  private async setTrashDaysUnlocked(days:unknown){
    if(typeof days!=="number"||!Number.isInteger(days)||days<0||days>365)throw bad("Срок хранения корзины: от 0 до 365 дней");
    this.trashDays=days;await this.save();return this.trashSettings();
  }
  /** Removes trashed files for good: all of them, or only those older than `olderThanMs`. */
  private async emptyTrashUnlocked(olderThanMs?:number,now=Date.now()){
    const doomed=this.entries.filter(e=>e.deletedAt&&(olderThanMs===undefined||now-new Date(e.deletedAt).getTime()>=olderThanMs));
    const staleFolders=this.deletedFolders.some(d=>olderThanMs===undefined||now-new Date(d.at).getTime()>=olderThanMs);
    if(!doomed.length&&!staleFolders)return {purged:0,bytes:0};
    let bytes=0;
    const objects:string[]=[];
    for(const e of doomed){
      objects.push(e.objectId??e.id);
      for(const revision of this.versions[e.id]??[]){objects.push(revision.objectId);bytes+=revision.size;}
      delete this.versions[e.id];bytes+=e.size;
    }
    const gone=new Set(doomed.map(e=>e.id));
    this.entries=this.entries.filter(e=>!gone.has(e.id));
    // a trashed folder whose files are gone for good can no longer be restored
    this.deletedFolders=this.deletedFolders.filter(d=>(olderThanMs!==undefined&&now-new Date(d.at).getTime()<olderThanMs)||this.entries.some(e=>e.deletedAt&&(e.folder===d.root||e.folder.startsWith(d.root+"/"))));
    await this.save();
    // Unreferenced bytes can be cleaned later if unlink fails; the catalog stays valid.
    for(const object of objects)await rm(this.objectPath(object),{force:true}).catch(()=>{});
    return {purged:doomed.length,bytes};
  }
  /** Auto-clean on the owner's schedule; cheap when nothing is due. */
  purgeExpired(now=Date.now()){return this.mutate(() => this.trashDays?this.emptyTrashUnlocked(this.trashDays*86400000,now):Promise.resolve({purged:0,bytes:0}));}
  /** Plain text of a text file or a simple PDF, so JUUNIBI can answer questions about it. */
  async readText(id:string,max=100*1024){
    const {entry,path:file}=this.rawFile(id);
    const ext=entry.name.toLowerCase().split(".").pop()??"";
    const data=await readFile(file);
    let text:string;
    if(ext==="pdf")text=pdfText(data);
    else if(/^(txt|md|csv|json|log|ts|tsx|js|mjs|css|html|xml|yml|yaml|ini|py)$/.test(ext))text=new TextDecoder().decode(data);
    else throw bad("JUUNIBI читает только текстовые файлы и PDF",415);
    text=text.replace(/\r\n?/g,"\n").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
    if(!text)throw bad(ext==="pdf"?"В этом PDF нет текстового слоя (скан или картинки)":"Файл пустой",422);
    return {name:entry.name,text:text.slice(0,max),truncated:text.length>max};
  }
}

/**
 * Text from a PDF without a library: inflate content streams and read the strings shown by Tj/TJ.
 * Works for ordinary text PDFs; scans and fonts with private encodings give no readable text.
 */
/** A small PDF can unpack into gigabytes; reading text never needs more than this in total. */
const PDF_INFLATE_BUDGET=16*1024*1024;
export function pdfText(data:Buffer):string{
  const src=data.toString("latin1");
  const chunks:string[]=[];
  let budget=PDF_INFLATE_BUDGET;
  const stream=/stream\r?\n/g;let m:RegExpExecArray|null;
  while((m=stream.exec(src))){
    const start=m.index+m[0].length,end=src.indexOf("endstream",start);
    if(end<0)break;
    const dict=src.slice(Math.max(0,m.index-400),m.index);
    let body:Buffer=data.subarray(start,end);
    if(/FlateDecode/.test(dict.slice(dict.lastIndexOf("<<")))){
      if(budget<=0)break;
      try{body=inflateSync(body,{maxOutputLength:budget});}catch{stream.lastIndex=end;continue;}
      budget-=body.length;
    }
    const content=body.toString("latin1");
    if(/\bBT\b/.test(content))chunks.push(showText(content));
    stream.lastIndex=end;
  }
  const text=chunks.join("\n");
  // Mostly unreadable symbols means a private font encoding: say there is no text rather than return noise.
  const letters=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  return letters>=Math.max(8,text.replace(/\s/g,"").length*.6)?text:"";
}
function pdfString(raw:string):string{
  let out="";
  for(let i=0;i<raw.length;i++){
    const c=raw[i]!;
    if(c!=="\\"){out+=c;continue;}
    const n=raw[++i]??"";
    if(/[0-7]/.test(n)){let oct=n;while(oct.length<3&&/[0-7]/.test(raw[i+1]??""))oct+=raw[++i];out+=String.fromCharCode(parseInt(oct,8));}
    else out+=({n:"\n",r:"\r",t:"\t",b:"\b",f:"\f"} as Record<string,string>)[n]??(n==="\n"?"":n);
  }
  // UTF-16BE strings start with a byte-order mark.
  if(out.startsWith("\xfe\xff")){let u="";for(let i=2;i+1<out.length;i+=2)u+=String.fromCharCode(out.charCodeAt(i)<<8|out.charCodeAt(i+1));return u;}
  return out;
}
function showText(content:string):string{
  let out="";
  const token=/\((?:\\.|[^\\)])*\)|\[(?:\((?:\\.|[^\\)])*\)|[^\]])*\]\s*TJ|\bT\*|\bT[dD]\b|\bET\b|'|"/g;
  let t:RegExpExecArray|null;
  while((t=token.exec(content))){
    const v=t[0];
    if(v==="T*"||v==="Td"||v==="TD"||v==="'"||v==="\""){if(out&&!out.endsWith("\n"))out+="\n";continue;}
    if(v==="ET"){out+="\n";continue;}
    if(v.startsWith("[")){
      for(const part of v.matchAll(/\((?:\\.|[^\\)])*\)|-?\d+(?:\.\d+)?/g)){
        if(part[0].startsWith("("))out+=pdfString(part[0].slice(1,-1));
        else if(Number(part[0])<-200)out+=" ";
      }
      continue;
    }
    out+=pdfString(v.slice(1,-1));
  }
  return out;
}
