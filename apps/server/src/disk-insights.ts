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
  // Bounded index request: no writes, no cloud transmission, and never expose full document text.
  for (const f of eligible.slice(0, 100)) {
    try {
      const raw = await disk.readText(f.id, 100 * 1024);
      const terms = words(raw.text);
      samples.push({id:f.id,name:f.name,text:raw.text,set:new Set(terms.filter(w=>!stop.has(w))),terms});
    } catch { skipped++; }
  }
  skipped += Math.max(0, eligible.length - 100);
  const links: DiskInsights["links"] = [];
  const findings: DiskInsights["findings"] = [];
  for (let i=0;i<samples.length;i++) for(let j=i+1;j<samples.length;j++){
    const a=samples[i]!,b=samples[j]!;
    const shared=[...a.set].filter(w=>b.set.has(w)).length;
    const denom=Math.max(1,a.set.size+b.set.size-shared);
    const score=Math.round(100*shared/denom);
    if(score>=20 && shared>=5) links.push({from:a.id,to:b.id,score});
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
  for(const f of all) {
    const history=disk.fileVersions(f.id);
    if(history.length>1){revisedFiles++;revisions+=history.length-1;}
  }
  const count=(id:number,n:number,detail?:string):DiskInsight=>({id,value:num(n),detail});
  const metrics:DiskInsight[]=[
    count(4,allWords.length,"Извлечённые слова из доступных документов"),
    count(5,allChars,"Символы извлечённого текста"),
    count(13,0), // removed below: folder history needs independent evidence
    count(21,samples.length,"Успешно прочитанные документы"),
    count(22,unique.size,"Различные слова в анализируемом корпусе"),
    count(23,new Set(links.flatMap(x=>[x.from,x.to])).size),
    count(28,links.length,"Связи по пересечению слов"),
    count(30,eligible.length-samples.length,"Ещё не проанализированы"),
    count(31,revisions,"Сохранённые старые редакции"),
    count(38,revisedFiles,"Документы с историей редакций"),
    count(42,links.length,"Пары с похожим содержимым"),
    count(49,skipped,"Не удалось обработать или превышен лимит 100 документов"),
    count(72,unique.size,"Различные слова"),
    count(91,findings.length,"Найденные связи"),
    count(95,0), // not yet implemented: named-entity recognition
    count(102,links.length,"Пары тематически близких документов"),
    count(104,links.length,"Найденные пары связей"),
    count(107,revisedFiles,"Документы, имеющие версии"),
    count(109,samples.filter(s=>s.text.length>10000).length,"Документы с текстом более 10 тысяч символов"),
    count(117,allWords.filter(w=>allWords.indexOf(w)===allWords.lastIndexOf(w)).length,"Слова, встретившиеся однократно"),
    count(124,skipped,"Недоступные текстовые данные"),
    count(126,links.length,"Тематические мосты по словарному совпадению"),
    count(131,new Set(samples.flatMap(s=>[...s.set].slice(0,5))).size,"Различные слова в начальных наборах"),
    count(139,0) // not enough evidence for sustained folder structure
  ].filter(m=>![13,95,139].includes(m.id));
  if(samples.length){
    const longest=allSentences.sort((a,b)=>b.length-a.length)[0]??"";
    metrics.push({id:111,value:num(longest.length),detail:"Символов в самом длинном предложении"});
    const top=new Map<string,number>();for(const w of allWords)top.set(w,(top.get(w)??0)+1);
    const frequent=[...top].filter(([w])=>!stop.has(w)).sort((a,b)=>b[1]-a[1])[0];
    if(frequent)metrics.push({id:112,value:frequent[0],detail:`${frequent[1]} вхождений`});
  }
  return {generatedAt:new Date().toISOString(),analyzed:samples.length,eligible:eligible.length,skipped,metrics,links:links.slice(0,100),findings};
}
