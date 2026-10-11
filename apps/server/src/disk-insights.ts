import type { LocalDisk } from "./local-disk";

export type DiskInsight = { id: number; value: string; detail?: string | undefined };
export type DiskInsights = { generatedAt: string; analyzed: number; eligible: number; skipped: number; metrics: DiskInsight[]; links: { from: string; to: string; score: number }[]; findings: { kind: string; text: string; ids: string[] }[] };
const num = (n: number) => n.toLocaleString("ru-RU");
const words = (s: string) => s.toLocaleLowerCase("ru-RU").match(/[\p{L}\p{N}]{3,}/gu) ?? [];
const stop = new Set("это как для что или при его она они где когда если тот тех нет все был были ещё уже также тоже после перед между потому можно нужно".split(" "));
export async function analyzeDisk(disk: LocalDisk): Promise<DiskInsights> {
  const all = disk.list().files;
  const eligible = all.filter(f => /\.(txt|md|pdf|docx)$/i.test(f.name));
  const samples: { id: string; name: string; text: string; set: Set<string>; terms: string[] }[] = [];
  let skipped = 0;
  let unreadable = 0;
  // Bounded index request: no writes, no cloud transmission, and never expose full document text.
  for (const f of eligible.slice(0, 100)) {
    try {
      const raw = await disk.readText(f.id, 100 * 1024);
      const terms = words(raw.text);
      samples.push({id:f.id,name:f.name,text:raw.text,set:new Set(terms.filter(w=>!stop.has(w))),terms});
    } catch { skipped++; unreadable++; }
  }
  skipped += Math.max(0, eligible.length - 100);
  const links: DiskInsights["links"] = [];
  const findings: DiskInsights["findings"] = [];
  for (let i=0;i<samples.length;i++) for(let j=i+1;j<samples.length;j++){
    const a=samples[i]!,b=samples[j]!;
    const shared=[...a.set].filter(w=>b.set.has(w)).length;
    const denom=Math.max(1,a.set.size+b.set.size-shared);
    const score=Math.round(100*shared/denom);
    if(score>=20 && shared>=5 && all.find(x=>x.id===a.id)?.sha256!==all.find(x=>x.id===b.id)?.sha256) links.push({from:a.id,to:b.id,score});
  }
  links.sort((a,b)=>b.score-a.score);
  for(const link of links.slice(0,10)) {
    const a=samples.find(s=>s.id===link.from)!,b=samples.find(s=>s.id===link.to)!;
    findings.push({kind:"related",text:`Связанные документы: «${a.name}» и «${b.name}» (${link.score}% общих уникальных слов)`,ids:[a.id,b.id]});
  }
  const allWords=samples.flatMap(s=>s.terms);
  const allChars=samples.reduce((n,s)=>n+s.text.length,0);
  const allSentences=samples.flatMap(s=>s.text.split(/[.!?]+/).filter(x=>x.trim().length>10));
  const unique=new Set(allWords);
  let revisions=0;
  let revisedFiles=0;
  let mostRevised: {name:string;count:number}|null=null;
  for(const f of all) {
    const history=disk.fileVersions(f.id);
    if(history.length>1){revisedFiles++;revisions+=history.length-1;}
    if(history.length>1 && (!mostRevised || history.length-1>mostRevised.count))mostRevised={name:f.name,count:history.length-1};
  }
  const count=(id:number,n:number,detail?:string):DiskInsight=>({id,value:num(n),detail});
  // Every published metric has its own definition; unavailable metrics remain absent.
  const graph=new Map<string,Set<string>>();
  for(const l of links){if(!graph.has(l.from))graph.set(l.from,new Set());if(!graph.has(l.to))graph.set(l.to,new Set());graph.get(l.from)!.add(l.to);graph.get(l.to)!.add(l.from);}
  const visited=new Set<string>();let components=0;
  for(const id of graph.keys()){if(visited.has(id))continue;components++;const stack=[id];visited.add(id);while(stack.length){for(const next of graph.get(stack.pop()!)??[]){if(!visited.has(next)){visited.add(next);stack.push(next);}}}}
  const folderById=new Map(all.map(f=>[f.id,f.folder]));
  const metrics:DiskInsight[]=[
    count(4,allWords.length,"Извлечённые слова из доступных документов"),
    count(5,allChars,"Символы извлечённого текста"),
    count(21,samples.length,"Документы, текст которых удалось прочитать"),
    count(23,graph.size,"Документы с хотя бы одной связью"),
    count(30,eligible.length-samples.length,"Не обработанные документы, включая превышение лимита"),
    count(31,revisions,"Сохранённые предыдущие редакции"),
    count(42,links.length,"Пары похожих документов, исключая точные копии"),
    count(49,unreadable,"Документы с ошибками чтения"),
    count(72,allWords.length?Math.round(unique.size/allWords.length*100):0,"Процент различных слов среди всех слов"),
    count(102,links.filter(l=>l.score>=60).length,"Пары с сильным словарным сходством от 60%"),
    count(104,components,"Отдельные группы связанных документов"),
    count(109,samples.filter(s=>s.text.length>10000).length,"Документы с текстом длиннее десяти тысяч символов"),
    count(126,links.filter(l=>folderById.get(l.from)!==folderById.get(l.to)).length,"Связанные документы в разных папках")
  ];
  if(mostRevised)metrics.push({id:38,value:mostRevised.name,detail:`Редакций: ${mostRevised.count}`});
  if(samples.length){
    const longest=allSentences.sort((a,b)=>b.length-a.length)[0]??"";
    metrics.push({id:111,value:num(longest.length),detail:"Символов в самом длинном предложении"});
    const top=new Map<string,number>();for(const w of allWords)top.set(w,(top.get(w)??0)+1);
    const rare=[...top].find(([w,n])=>n===1 && !stop.has(w));
    if(rare)metrics.push({id:117,value:rare[0],detail:"Слово встречается один раз"});
    const frequent=[...top].filter(([w])=>!stop.has(w)).sort((a,b)=>b[1]-a[1])[0];
    if(frequent)metrics.push({id:112,value:frequent[0],detail:`${frequent[1]} вхождений`});
  }
  return {generatedAt:new Date().toISOString(),analyzed:samples.length,eligible:eligible.length,skipped,metrics,links:links.slice(0,100),findings};
}
