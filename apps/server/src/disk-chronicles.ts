/** Disk Chronicles: exactly 100 distinct metrics, 11 groups. Unavailable metrics are explicit. */
import type { DiskEntry } from "./local-disk";
export const DISK_GROUPS = [
  {
    "id": "g0",
    "title": "Сердце хранилища",
    "metrics": [
      {
        "id": "d01",
        "title": "Количество активных файлов"
      },
      {
        "id": "d02",
        "title": "Физический объём сохранённых данных"
      },
      {
        "id": "d03",
        "title": "Количество созданных папок"
      },
      {
        "id": "d04",
        "title": "Медианный размер файла"
      },
      {
        "id": "d05",
        "title": "Размер крупнейшего файла"
      },
      {
        "id": "d06",
        "title": "Количество используемых расширений"
      },
      {
        "id": "d07",
        "title": "Доля занятого пространства диска"
      },
      {
        "id": "d08",
        "title": "Среднее количество файлов в непустой папке"
      },
      {
        "id": "d09",
        "title": "Число файлов без папки"
      }
    ]
  },
  {
    "id": "g1",
    "title": "Анатомия коллекции",
    "metrics": [
      {
        "id": "d10",
        "title": "PDF-документы"
      },
      {
        "id": "d11",
        "title": "Офисные документы"
      },
      {
        "id": "d12",
        "title": "Электронные таблицы"
      },
      {
        "id": "d13",
        "title": "Изображения"
      },
      {
        "id": "d14",
        "title": "Аудиофайлы"
      },
      {
        "id": "d15",
        "title": "Видеофайлы"
      },
      {
        "id": "d16",
        "title": "Архивы"
      },
      {
        "id": "d17",
        "title": "Исходный код и конфигурация"
      },
      {
        "id": "d18",
        "title": "Файлы неизвестного формата"
      }
    ]
  },
  {
    "id": "g2",
    "title": "Пульс активности",
    "metrics": [
      {
        "id": "d19",
        "title": "Загрузки за 24 часа"
      },
      {
        "id": "d20",
        "title": "Объём загрузок за семь дней"
      },
      {
        "id": "d21",
        "title": "Среднее число загрузок за активный день"
      },
      {
        "id": "d22",
        "title": "Самый активный час суток"
      },
      {
        "id": "d23",
        "title": "Дни с загрузками за 30 дней"
      },
      {
        "id": "d24",
        "title": "Текущая серия дней с загрузками"
      },
      {
        "id": "d25",
        "title": "Рекорд загрузок за день"
      },
      {
        "id": "d26",
        "title": "Загрузки по дням недели"
      },
      {
        "id": "d27",
        "title": "Самая длинная пауза между загрузками"
      }
    ]
  },
  {
    "id": "g3",
    "title": "Архитектура порядка",
    "metrics": [
      {
        "id": "d28",
        "title": "Папка с наибольшим объёмом"
      },
      {
        "id": "d29",
        "title": "Количество пустых папок"
      },
      {
        "id": "d30",
        "title": "Доля файлов в именованных папках"
      },
      {
        "id": "d31",
        "title": "Переносы между папками"
      },
      {
        "id": "d32",
        "title": "Переименования файлов"
      },
      {
        "id": "d33",
        "title": "Папки без изменений 90 дней"
      },
      {
        "id": "d34",
        "title": "Максимум файлов в одной папке"
      },
      {
        "id": "d35",
        "title": "Распределение файлов по папкам"
      },
      {
        "id": "d36",
        "title": "Файлы с более чем тремя перемещениями"
      }
    ]
  },
  {
    "id": "g4",
    "title": "Золотой архив",
    "metrics": [
      {
        "id": "d37",
        "title": "Файлы в избранном"
      },
      {
        "id": "d38",
        "title": "Размер избранных файлов"
      },
      {
        "id": "d39",
        "title": "Возраст старейшего избранного файла"
      },
      {
        "id": "d40",
        "title": "Добавления в избранное за месяц"
      },
      {
        "id": "d41",
        "title": "Исключения из избранного за месяц"
      },
      {
        "id": "d42",
        "title": "Доля избранного среди документов"
      },
      {
        "id": "d43",
        "title": "Папка с наибольшей концентрацией избранного"
      },
      {
        "id": "d44",
        "title": "Среднее время до добавления в избранное"
      },
      {
        "id": "d45",
        "title": "Повторно избранные файлы"
      }
    ]
  },
  {
    "id": "g5",
    "title": "Детектив файлов",
    "metrics": [
      {
        "id": "d46",
        "title": "Группы одинаковых SHA-256"
      },
      {
        "id": "d47",
        "title": "Потенциально освобождаемый объём дубликатов"
      },
      {
        "id": "d48",
        "title": "Файлы с одинаковыми именами"
      },
      {
        "id": "d49",
        "title": "Расширения, встречающиеся один раз"
      },
      {
        "id": "d50",
        "title": "Самое длинное название файла"
      },
      {
        "id": "d51",
        "title": "Файлы без расширения"
      },
      {
        "id": "d52",
        "title": "Подозрительные двойные расширения"
      },
      {
        "id": "d53",
        "title": "Несовпадение содержимого и расширения"
      },
      {
        "id": "d54",
        "title": "Дубликаты с разными именами"
      }
    ]
  },
  {
    "id": "g6",
    "title": "Страж безопасности",
    "metrics": [
      {
        "id": "d55",
        "title": "Успешно проверенные файлы"
      },
      {
        "id": "d56",
        "title": "Нарушения SHA-256"
      },
      {
        "id": "d57",
        "title": "Охват последней проверки"
      },
      {
        "id": "d58",
        "title": "Время последней полной проверки"
      },
      {
        "id": "d59",
        "title": "Отсутствующие файлы при проверке"
      },
      {
        "id": "d60",
        "title": "Восстановления из резервной копии"
      },
      {
        "id": "d61",
        "title": "Последняя успешная резервная копия"
      },
      {
        "id": "d62",
        "title": "Неудачные восстановления"
      },
      {
        "id": "d63",
        "title": "Файлы, изменённые вне JUUNIBI"
      }
    ]
  },
  {
    "id": "g7",
    "title": "Машина времени",
    "metrics": [
      {
        "id": "d64",
        "title": "Дата первой загрузки"
      },
      {
        "id": "d65",
        "title": "Возраст старейшего активного файла"
      },
      {
        "id": "d66",
        "title": "Средний возраст файлов"
      },
      {
        "id": "d67",
        "title": "Файлы старше года"
      },
      {
        "id": "d68",
        "title": "Месяц с максимумом загрузок"
      },
      {
        "id": "d69",
        "title": "Прирост активного объёма за 30 дней"
      },
      {
        "id": "d70",
        "title": "Восстановления из корзины за квартал"
      },
      {
        "id": "d71",
        "title": "Среднее время в корзине"
      },
      {
        "id": "d72",
        "title": "Безвозвратные удаления за год"
      }
    ]
  },
  {
    "id": "g8",
    "title": "Цифровая вселенная",
    "metrics": [
      {
        "id": "d73",
        "title": "Доля пяти крупнейших файлов"
      },
      {
        "id": "d74",
        "title": "Соотношение документов и медиа по объёму"
      },
      {
        "id": "d75",
        "title": "Горизонтальные изображения"
      },
      {
        "id": "d76",
        "title": "Вертикальные изображения"
      },
      {
        "id": "d77",
        "title": "Длительность аудиозаписей"
      },
      {
        "id": "d78",
        "title": "Длительность видео"
      },
      {
        "id": "d79",
        "title": "Количество страниц PDF"
      },
      {
        "id": "d80",
        "title": "Файлы, ни разу не скачанные"
      },
      {
        "id": "d81",
        "title": "Число MIME-типов"
      }
    ]
  },
  {
    "id": "g9",
    "title": "Легенды Диска",
    "metrics": [
      {
        "id": "d82",
        "title": "Исторический максимум числа файлов"
      },
      {
        "id": "d83",
        "title": "Исторический максимум объёма"
      },
      {
        "id": "d84",
        "title": "Рекорд создания папок за неделю"
      },
      {
        "id": "d85",
        "title": "Самая длинная серия без ошибок целостности"
      },
      {
        "id": "d86",
        "title": "Завершённые аудиты"
      },
      {
        "id": "d87",
        "title": "Рекорд пакетной операции"
      },
      {
        "id": "d88",
        "title": "Дней с последнего окончательного удаления"
      },
      {
        "id": "d89",
        "title": "Максимум восстановлений за день"
      },
      {
        "id": "d90",
        "title": "Число событий в журнале"
      }
    ]
  }
,{"id":"g10","title":"Созвездие коллекции","metrics":[{"id":"d91","title":"Файлов в корзине"},{"id":"d92","title":"Объём корзины"},{"id":"d93","title":"Крупнейший файл корзины"},{"id":"d94","title":"Доля объёма избранного"},{"id":"d95","title":"Папки с избранным"},{"id":"d96","title":"Файлы меньше килобайта"},{"id":"d97","title":"Файлы от 1 КБ до 10 МБ"},{"id":"d98","title":"Популярнейшее расширение"},{"id":"d99","title":"Уникальные контрольные суммы"},{"id":"d100","title":"Доля удалённых файлов"}]}] as const;
export type DiskMetric = {id:string;title:string;value:string;ready:boolean;reason?:string;series?:number[]};
const fmt=(n:number)=>Math.round(n).toLocaleString("ru-RU");
const bytes=(n:number)=>n<1024?fmt(n)+" Б":n<1048576?(n/1024).toFixed(1)+" КБ":(n/1048576).toFixed(1)+" МБ";
const ext=(name:string)=>name.includes(".")?name.split(".").pop()!.toLowerCase():"";
const category=(x:string)=>{
 if(x==="pdf")return "pdf";
 if(["doc","docx","odt","txt","rtf","md"].includes(x))return "office";
 if(["xls","xlsx","ods","csv"].includes(x))return "sheets";
 if(["png","jpg","jpeg","webp","gif","bmp","svg"].includes(x))return "image";
 if(["mp3","wav","ogg","flac","m4a"].includes(x))return "audio";
 if(["mp4","mkv","mov","webm","avi"].includes(x))return "video";
 if(["zip","rar","7z","tar","gz"].includes(x))return "archive";
 if(["js","ts","tsx","jsx","py","go","rs","java","json","yaml","yml","xml","html","css","toml","ini"].includes(x))return "code";
 return "unknown";
};
export function diskChronicles(entries:DiskEntry[],folders:string[],now=Date.now()){
 const active=entries.filter(e=>!e.deletedAt), trash=entries.filter(e=>!!e.deletedAt);
 const size=(xs:DiskEntry[])=>xs.reduce((n,e)=>n+e.size,0);
 const values=new Map<string,string>();
 const set=(n:number,v:string|number)=>values.set("d"+String(n).padStart(2,"0"),String(v));
 const extension=(e:DiskEntry)=>ext(e.name);
 const sorted=[...active].sort((a,b)=>a.size-b.size);
 const age=(e:DiskEntry)=>Math.max(0,Math.floor((now-Date.parse(e.uploadedAt))/86400000));
 const recently=(e:DiskEntry,days:number)=>Date.parse(e.uploadedAt)>=now-days*86400000&&Date.parse(e.uploadedAt)<=now;
 set(1,fmt(active.length));set(2,bytes(size(entries)));set(3,fmt(folders.length));
 set(4,sorted.length?bytes(sorted[Math.floor((sorted.length-1)/2)]!.size):"0 Б");
 set(5,bytes(sorted.at(-1)?.size??0));
 set(6,fmt(new Set(active.map(extension).filter(Boolean)).size));
 const counts=new Map<string,number>();
 for(const e of active)counts.set(e.folder,(counts.get(e.folder)??0)+1);
 const filled=[...counts.entries()].filter(([k])=>!!k);
 set(8,filled.length?(active.filter(e=>e.folder).length/filled.length).toFixed(1):"0");
 set(9,fmt(counts.get("")??0));
 const types=["pdf","office","sheets","image","audio","video","archive","code","unknown"];
 types.forEach((c,i)=>set(10+i,fmt(active.filter(e=>category(extension(e))===c).length)));
 set(19,fmt(active.filter(e=>recently(e,1)).length));
 set(20,bytes(size(active.filter(e=>recently(e,7)))));
 const days=new Map<string,number>();
 for(const e of active){const day=e.uploadedAt.slice(0,10);days.set(day,(days.get(day)??0)+1);}
 set(21,days.size?(active.length/days.size).toFixed(1):"0");
 set(23,fmt(active.filter(e=>recently(e,30)).reduce((acc,e)=>acc.add(e.uploadedAt.slice(0,10)),new Set<string>()).size));
 set(25,fmt(Math.max(0,...days.values())));
 const weekday=Array.from({length:7},()=>0);
 for(const e of active){const d=new Date(e.uploadedAt);if(Number.isFinite(d.getTime()))weekday[(d.getUTCDay()+6)%7]!++;}
 set(26,weekday.map((v,i)=>["Пн","Вт","Ср","Чт","Пт","Сб","Вс"][i]+": "+v).join(" · "));
 const byFolder=[...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0],"ru"));
 const folderSizes=folders.map(folder=>({folder,size:size(active.filter(e=>e.folder===folder))})).sort((a,b)=>b.size-a.size);
 set(28,folderSizes.length?folderSizes[0]!.folder+" · "+bytes(folderSizes[0]!.size):"Нет папок");
 set(29,fmt(folders.filter(f=>!counts.get(f)).length));
 set(30,active.length?Math.round(active.filter(e=>e.folder).length/active.length*100)+"%":"0%");
 set(34,fmt(Math.max(0,...counts.values())));
 set(35,byFolder.map(([folder,count])=>(folder||"Главная")+": "+count).join(" · ")||"Нет файлов");
 const favorites=active.filter(e=>e.favorite);
 set(37,fmt(favorites.length));set(38,bytes(size(favorites)));
 set(39,favorites.length?fmt(Math.max(...favorites.map(age)))+" дней":"Нет избранных");
 const docs=active.filter(e=>["pdf","office","sheets"].includes(category(extension(e))));
 set(42,docs.length?Math.round(docs.filter(e=>e.favorite).length/docs.length*100)+"%":"Нет документов");
 const fp=folders.map(folder=>({folder,n:active.filter(e=>e.folder===folder).length,f:active.filter(e=>e.folder===folder&&e.favorite).length})).filter(x=>x.n).sort((a,b)=>b.f/b.n-a.f/a.n);
 set(43,fp[0]?fp[0].folder+" · "+Math.round(fp[0].f/fp[0].n*100)+"%":"Нет данных");
 const hashed=new Map<string,DiskEntry[]>();
 for(const e of active){const group=hashed.get(e.sha256)??[];group.push(e);hashed.set(e.sha256,group);}
 const duplicateGroups=[...hashed.values()].filter(g=>g.length>1);
 set(46,fmt(duplicateGroups.length));
 set(47,bytes(duplicateGroups.reduce((n,g)=>n+g.slice(1).reduce((v,e)=>v+e.size,0),0)));
 const names=new Map<string,number>();
 for(const e of active)names.set(e.name,(names.get(e.name)??0)+1);
 set(48,fmt([...names.values()].filter(n=>n>1).reduce((n,v)=>n+v,0)));
 const extensions=new Map<string,number>();
 for(const e of active){const x=extension(e);if(x)extensions.set(x,(extensions.get(x)??0)+1);}
 set(49,fmt([...extensions.values()].filter(n=>n===1).length));
 set(50,active.length?[...active].sort((a,b)=>b.name.length-a.name.length)[0]!.name:"Нет файлов");
 set(51,fmt(active.filter(e=>!extension(e)).length));
 set(52,fmt(active.filter(e=>/\.(exe|js|bat|cmd|scr|vbs)\.(txt|pdf|jpg|png)$/i.test(e.name)).length));
 set(54,fmt(duplicateGroups.filter(g=>new Set(g.map(e=>e.name)).size>1).reduce((n,g)=>n+g.length,0)));
 set(73,active.length?Math.round(sorted.slice(-5).reduce((n,e)=>n+e.size,0)/size(active)*100)+"%":"0%");
 const docSize=size(docs),mediaSize=size(active.filter(e=>["image","audio","video"].includes(category(extension(e)))));
 set(74,bytes(docSize)+" / "+bytes(mediaSize));
 set(64,active.length?[...active].sort((a,b)=>a.uploadedAt.localeCompare(b.uploadedAt))[0]!.uploadedAt.slice(0,10):"Нет файлов");
 set(65,active.length?fmt(Math.max(...active.map(age)))+" дней":"Нет файлов");
 set(66,active.length?fmt(active.reduce((n,e)=>n+age(e),0)/active.length)+" дней":"Нет файлов");
 set(67,fmt(active.filter(e=>age(e)>=365).length));
 const months=new Map<string,number>();
 for(const e of active){const m=e.uploadedAt.slice(0,7);months.set(m,(months.get(m)??0)+1);}
 set(68,[...months.entries()].sort((a,b)=>b[1]-a[1])[0]?.join(" · ")??"Нет файлов");



 set(91,fmt(trash.length));
 set(92,bytes(size(trash)));
 set(93,bytes(Math.max(0,...trash.map(e=>e.size))));
 set(94,size(active)?Math.round(size(favorites)/size(active)*100)+"%":"0%");
 set(95,fmt(new Set(favorites.map(e=>e.folder).filter(Boolean)).size));
 set(96,fmt(active.filter(e=>e.size<1024).length));
 set(97,fmt(active.filter(e=>e.size>=1024&&e.size<=10485760).length));
 set(98,[...extensions.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]??"Нет");
 set(99,fmt(new Set(active.map(e=>e.sha256)).size));
 set(100,entries.length?Math.round(trash.length/entries.length*100)+"%":"0%");
 const metrics:DiskMetric[]=DISK_GROUPS.flatMap(g=>g.metrics.map(m=>values.has(m.id)?{id:m.id,title:m.title,value:values.get(m.id)!,ready:true}:{id:m.id,title:m.title,value:"—",ready:false,reason:"Нет данных: требуется журнал событий, проверка файлов или анализ содержимого"}));
 return {groups:DISK_GROUPS.map(g=>({id:g.id,title:g.title})),metrics,summary:{files:active.length,bytes:size(entries),folders:folders.length,ready:metrics.filter(m=>m.ready).length,total:metrics.length}};
}
