/** 150 uniquely identified disk metrics. Unknown measures must never be fabricated. */
import { api, type DiskFile } from "../api";
import { el } from "../dom";
import { human } from "./disk-model";

const CATEGORIES = [
  {
    "title": "Анатомия документов",
    "emoji": "📜",
    "names": [
      "Всего документов",
      "Новые документы",
      "Удалённые документы",
      "Количество слов",
      "Количество символов",
      "Страниц написано",
      "Самый большой документ",
      "Самый маленький документ",
      "Средняя длина документа",
      "Самый старый документ"
    ]
  },
  {
    "title": "Жизнь папок",
    "emoji": "🗂️",
    "names": [
      "Всего папок",
      "Новые папки",
      "Удалённые папки",
      "Глубина дерева",
      "Самая большая папка",
      "Самая пустая папка",
      "Самая активная папка",
      "Заброшенные папки",
      "Перемещённые документы",
      "Рост папок за месяц"
    ]
  },
  {
    "title": "Интеллект библиотеки",
    "emoji": "🧠",
    "names": [
      "Изученные документы",
      "Распознанные темы",
      "Связанные документы",
      "Новые знания",
      "Найденные противоречия",
      "Извлечённые факты",
      "Найденные определения",
      "Семантические связи",
      "Качество распознавания",
      "Документы без анализа"
    ]
  },
  {
    "title": "История и развитие",
    "emoji": "🕰️",
    "names": [
      "История редактирования",
      "Добавлено слов",
      "Удалено слов",
      "Переписано фрагментов",
      "Восстановлено документов",
      "Частота изменений",
      "Самый продуктивный день",
      "Самый редактируемый документ",
      "Дни активности",
      "Хронология библиотеки"
    ]
  },
  {
    "title": "Здоровье диска",
    "emoji": "🛡️",
    "names": [
      "Точные дубликаты",
      "Похожие документы",
      "Повреждённые файлы",
      "Файлы без названия",
      "Неподдерживаемые форматы",
      "Проверки целостности",
      "Резервные копии",
      "Ошибки индексации",
      "Неразобранные документы",
      "Сэкономленное место"
    ]
  },
  {
    "title": "Активность и привычки",
    "emoji": "📈",
    "names": [
      "Чаще открываемые документы",
      "Любимые категории",
      "Частые поисковые запросы",
      "Документы без просмотров",
      "Активность по часам",
      "Активность по неделям",
      "Рост объёма текстов",
      "Основные темы месяца",
      "Количество прочтений",
      "Время работы с документами"
    ]
  },
  {
    "title": "Рекорды и достижения",
    "emoji": "🏆",
    "names": [
      "Первый документ",
      "Тысяча документов",
      "Миллион слов",
      "Самый длинный текст",
      "Самая большая коллекция",
      "Рекорд за день",
      "Самый изучаемый документ",
      "Рекорд непрерывной активности",
      "Достижения по организации",
      "Книга жизни библиотеки"
    ]
  },
  {
    "title": "Содержание и структура",
    "emoji": "🧩",
    "names": [
      "Сложность текста",
      "Словарное богатство",
      "Структура документа",
      "Табличный мир",
      "Визуальное наполнение",
      "Внешние источники",
      "Цитаты и выдержки",
      "Открытые вопросы",
      "Ключевые мысли",
      "Незавершённые разделы"
    ]
  },
  {
    "title": "Порядок и автоматизация",
    "emoji": "⚙️",
    "names": [
      "Каталог тегов",
      "Точность классификации",
      "Входящий поток",
      "Исходящие документы",
      "Автоматические названия",
      "Очередь сортировки",
      "Архивирование",
      "Защищённые документы",
      "Конвертация форматов",
      "Полнота карточек"
    ]
  },
  {
    "title": "Ценность и использование",
    "emoji": "💎",
    "names": [
      "Полезные находки",
      "Неудачные поиски",
      "Вопросы к библиотеке",
      "Подтверждённые ответы",
      "Извлечённые сущности",
      "Найденные сроки",
      "Выполненные обязательства",
      "Расхождения версий",
      "Сводные материалы",
      "Индекс организации"
    ]
  },
  {
    "title": "Тайная жизнь документов",
    "emoji": "👻",
    "names": [
      "Документы-призраки",
      "Тайные родственники",
      "Вампиры памяти",
      "Паутина секретов",
      "Матрёшки",
      "Пришельцы",
      "Мудрый старец",
      "Детективная находка",
      "Спящие гиганты",
      "Магнит внимания"
    ]
  },
  {
    "title": "Весёлые рекорды",
    "emoji": "😂",
    "names": [
      "Словесная лапша",
      "Попугай дня",
      "Господин Сложность",
      "Взрыв мозга",
      "Черепашья мысль",
      "Острый язычок",
      "Единорог",
      "Мастер перевоплощений",
      "Сыр с дырками",
      "Бесконечная история"
    ]
  },
  {
    "title": "Интеллектуальные открытия",
    "emoji": "💡",
    "names": [
      "Искра озарения",
      "Предсказатель",
      "Охотник за гипотезами",
      "Потерянный контекст",
      "Зеркало противоречий",
      "Мост между мирами",
      "Недостающий пазл",
      "Знание из будущего",
      "Неожиданная закономерность",
      "Лисья догадка"
    ]
  },
  {
    "title": "Вселенная файлов",
    "emoji": "🌌",
    "names": [
      "Планеты знаний",
      "Космический путешественник",
      "Извержение идей",
      "Ледниковый период",
      "Пиратские сокровища",
      "Неизведанная территория",
      "Волна знаний",
      "Эффект бабочки",
      "Крепость документов",
      "Дракон библиотеки"
    ]
  },
  {
    "title": "Характер библиотеки",
    "emoji": "💖",
    "names": [
      "Улыбка библиотеки",
      "Дождливые страницы",
      "Американские горки",
      "Самый уютный текст",
      "Поле споров",
      "Миротворец",
      "Радуга настроений",
      "Ритм прозы",
      "Тёплые слова",
      "Лисий сюрприз"
    ]
  }
] as const;
const STORAGE_KEY = "juunibi.disk.life.open";
const numeric = (n: number) => n.toLocaleString("ru-RU");

export function diskLifePanel(getFiles: () => DiskFile[], getFolders: () => string[], getTrash: () => DiskFile[]): {root: HTMLElement; refresh: () => void} {
  const root = el("aside", { cls: "dk-life", attrs: { "aria-label": "Жизнь документов" } });
  const search = el("input", { cls: "dk-life-search", type: "search", placeholder: "Найти показатель…", attrs: { "aria-label": "Поиск показателей" } }) as HTMLInputElement;
  const grid = el("div", { cls: "dk-life-groups" });
  let insights = new Map<number,{value:string;detail:string|undefined}>();
  const insightNote = el("small", {cls:"dk-life-sub",textContent:"Анализ содержания запускается отдельно"});
  const headline = el("small", { cls: "dk-life-sub", textContent: "150 уникальных показателей · только реальные данные" });
  const asMetric = (id: number, files: DiskFile[], folders: string[], trash: DiskFile[]): string | null => {
    const thirty = Date.now() - 30 * 86400000;
    const sizes = files.map(f => f.size);
    const countByFolder = new Map<string,number>();
    for (const f of files) countByFolder.set(f.folder, (countByFolder.get(f.folder) ?? 0) + 1);
    const duplicates = new Map<string,number>();
    for (const f of files) if (f.sha256) duplicates.set(f.sha256, (duplicates.get(f.sha256) ?? 0) + 1);
    const values: Record<number, () => string> = {
      1: () => numeric(files.length),
      2: () => numeric(files.filter(f => Date.parse(f.uploadedAt) >= thirty).length),
      3: () => numeric(trash.length),
      7: () => sizes.length ? human(Math.max(...sizes)) : "0 Б",
      8: () => sizes.length ? human(Math.min(...sizes)) : "0 Б",
      11: () => numeric(folders.length),
      14: () => numeric(folders.reduce((m,f) => Math.max(m,f.split("/").length),0)),
      15: () => folders.length ? (folders.slice().sort((a,b)=>(countByFolder.get(b)??0)-(countByFolder.get(a)??0))[0] ?? "—") : "—",
      16: () => numeric(folders.filter(f => !countByFolder.get(f)).length),
      41: () => numeric([...duplicates.values()].reduce((sum,n)=>sum+Math.max(0,n-1),0)),
      81: () => numeric(new Set(files.flatMap(f => f.tags ?? [])).size),
      83: () => numeric(files.filter(f => Date.parse(f.uploadedAt) >= thirty).length)
    };
    // Catalogue metadata is not evidence of document content, reading time, revisions or semantic analysis.
    return insights.get(id)?.value ?? values[id]?.() ?? null;
  };
  const refresh = () => {
    const files = getFiles(), folders = getFolders(), trash = getTrash();
    const query = search.value.trim().toLocaleLowerCase("ru-RU");
    const open = (() => {try{return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)??'["0","1"]') as string[]);}catch{return new Set(["0","1"]);}})();
    const blocks = CATEGORIES.map((category, groupIndex) => {
      const items = category.names.map((name, i) => ({name,id:groupIndex*10+i+1})).filter(m => !query || m.name.toLocaleLowerCase("ru-RU").includes(query) || category.title.toLocaleLowerCase("ru-RU").includes(query));
      if (!items.length) return null;
      const body = el("div", { cls: "dk-life-tiles" }, ...items.map(item => {
        const value = asMetric(item.id,files,folders,trash);
        return el("article", { cls: "dk-life-tile" + (value === null ? " pending" : ""), title: value === null ? "Для расчёта нужен отдельный сбор данных" : "Рассчитано по каталогу диска" },
          el("span", { cls: "dk-life-tile-icon", textContent: category.emoji }),
          el("span", { cls: "dk-life-tile-label", textContent: item.name }),
          el("strong", { cls: "dk-life-tile-value", textContent: value ?? "Нет данных" }),
          el("small", { textContent: "#"+item.id+" · "+(value === null ? "ожидает анализа" : "по каталогу") }));
      }));
      const details = el("details", { cls: "dk-life-group", open: !!query || open.has(String(groupIndex)) },
        el("summary", {}, el("span", { textContent: category.emoji }), el("b", { textContent: category.title }), el("small", { textContent: String(items.length) }), el("span", { textContent: "⌄" })), body);
      details.addEventListener("toggle", () => {
        if (query) return;
        const changed = (() => {try{return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)??"[]") as string[]);}catch{return new Set<string>();}})();
        if(details.open)changed.add(String(groupIndex));else changed.delete(String(groupIndex));
        try{localStorage.setItem(STORAGE_KEY,JSON.stringify([...changed]));}catch{/* private mode */}
      });
      return details;
    }).filter((x):x is HTMLDetailsElement=>x!==null);
    grid.replaceChildren(...blocks);
  };
  search.addEventListener("input",refresh);
  const analyze = el("button", {cls:"btn",type:"button",textContent:"🧠 Анализировать документы"});
  analyze.addEventListener("click",async()=>{
    analyze.disabled=true; insightNote.textContent="Читаю документы локально…";
    try {
      const result=await api.diskInsights();
      if(result.ok){ insights=new Map(result.value.metrics.map(m=>[m.id,{value:m.value,detail:m.detail}]));
        insightNote.textContent=`Проверено ${result.value.analyzed} из ${result.value.eligible} · связей: ${result.value.links.length}`;
        const findings=result.value.findings.slice(0,3).map(x=>x.text);
        discoveries.replaceChildren(...findings.map(x=>el("p",{textContent:"🦊 "+x})));
        if(!findings.length) discoveries.replaceChildren(el("p",{textContent:"Пока нет подтверждённых совпадений между документами."}));
        refresh();
      }else insightNote.textContent="Ошибка анализа: "+result.error.message;
    } finally {analyze.disabled=false;}
  });
  const discoveries=el("div",{cls:"dk-life-findings"});
  root.append(el("header", { cls: "dk-life-header" },el("span",{cls:"dk-life-mark",textContent:"🦊"}),el("div",{},el("strong",{textContent:"Жизнь документов"}),headline)),search,analyze,insightNote,discoveries,grid);
  refresh();
  return {root,refresh};
}
