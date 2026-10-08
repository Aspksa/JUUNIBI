import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import type { LlmProvider } from "@juunibi/assistant";
interface Action { id: string; text: string; category: string; emotion?: string; duration_seconds?: number; animation_cues?: { ears?: string; tails?: number; gaze?: string; timing?: string }; tags?: string[] }
interface Phrase { id: string; text: string; category: string; emotion?: string }
interface History { used: string[]; created: Action[]; phrasesUsed: string[] }
export class SceneEngine {
  private actions: Action[] = [];
  private phrases: Phrase[] = [];
  private state: History = { used: [], created: [], phrasesUsed: [] };
  private current: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private provider: () => LlmProvider | undefined) {}
  async init() {
    const assets = path.join(this.root, "apps", "server", "assets");
    const a = JSON.parse(await readFile(path.join(assets,"JUUNIBI_365_cinematic_actions.json"),"utf8"));
    const p = JSON.parse(await readFile(path.join(assets,"JUUNIBI_452_phrases.json"),"utf8"));
    this.actions = a.actions; this.phrases = p.phrases;
    if (this.actions.length !== 365 || this.phrases.length !== 452 || new Set(this.actions.map(x=>x.id)).size !== 365) throw new Error("Некорректный каталог сцен");
    try {
      const saved = JSON.parse(await readFile(this.storePath(),"utf8"));
      if (Array.isArray(saved.used) && Array.isArray(saved.created) && Array.isArray(saved.phrasesUsed)) this.state = saved;
    } catch { /* first run */ }
  }
  private storePath() { return path.join(this.root,"data","juunibi-scenes.json"); }
  private async save() {
    await mkdir(path.dirname(this.storePath()),{recursive:true});
    const tmp=this.storePath()+".tmp";
    await writeFile(tmp,JSON.stringify(this.state),{mode:0o600});
    await rename(tmp,this.storePath());
  }
  stats() { const all=[...this.actions,...this.state.created];return { total:all.length, used:new Set(this.state.used).size, remaining:all.filter(x=>!this.state.used.includes(x.id)).length, phrases:this.phrases.length, generated:this.state.created.length }; }
  private normalized(s:string) { return s.toLowerCase().normalize("NFKC").replace(/[^а-яёa-z0-9]+/g," ").trim(); }
  private shingles(s:string) { const a=this.normalized(s).split(" ");return new Set(a.slice(0,-2).map((_,i)=>a.slice(i,i+3).join(" "))); }
  private similar(a:string,b:string) { const x=this.shingles(a),y=this.shingles(b);let n=0;for(const z of x)if(y.has(z))n++;return n/Math.max(1,x.size+y.size-n); }
  private async generate() {
    const llm=this.provider();if(!llm)throw new Error("Все сцены использованы. Подключите Cloud.ru для генерации новой.");
    const existing=[...this.actions,...this.state.created].map(x=>x.text);
    for(let attempt=0;attempt<5;attempt++){
      const response=await llm.chat([{role:"system",content:"Создай ОДНО новое кинематографичное действие перед речью двенадцатихвостой лисицы. На русском, 1–3 предложения, без имени и прямой речи, не более 12 хвостов. Верни только JSON: {\\"text\\":\\"...\\",\\"category\\":\\"новое\\",\\"emotion\\":\\"warm\\",\\"duration_seconds\\":4.5}."},{role:"user",content:"Избегай повторения этих примеров: "+existing.slice(-80).join(" | ").slice(0,10000)}]);
      try {
        const proposal=JSON.parse((response.content??"").replace(/^\\s*```(?:json)?|\\s*```\\s*$/g,"").trim());
        const text=String(proposal.text??"").trim();
        if(text.length<55||text.length>600||/juunibi|джууниби|[«»]/i.test(text)||!/[а-яё]/i.test(text))continue;
        if(existing.some(x=>this.normalized(x)===this.normalized(text)||this.similar(x,text)>0.42))continue;
        const generated:Action={id:"JUA-GEN-"+randomUUID(),text,category:String(proposal.category??"новое").slice(0,60),emotion:String(proposal.emotion??"warm"),duration_seconds:Math.min(8,Math.max(1,Number(proposal.duration_seconds)||4.5)),animation_cues:{ears:"contextual",tails:12,gaze:"toward_master",timing:"before_speech"}};
        this.state.created.push(generated);return generated;
      }catch { /* retry malformed response */ }
    }
    throw new Error("Не удалось создать достаточно непохожую сцену; повторы запрещены.");
  }
  async next(category?:string) {
    const task=this.current.then(async()=>{
      const all=[...this.actions,...this.state.created];
      const unused=all.filter(x=>!this.state.used.includes(x.id));
      const available=category?unused.filter(x=>x.category===category):unused;
      const action=available.length?available[randomInt(available.length)]!:await this.generate();
      const greetings=this.phrases.filter(x=>x.category==="приветствие"&&!this.state.phrasesUsed.includes(x.id));
      const phrase=greetings.length?greetings[randomInt(greetings.length)]!:undefined;
      this.state.used.push(action.id);
      if(phrase)this.state.phrasesUsed.push(phrase.id);
      await this.save();
      return {action,phrase:phrase??null,stats:this.stats()};
    });
    this.current=task.then(()=>undefined,()=>undefined);
    return task;
  }
}
