/** "Дела": to-dos, notes and reminders on one page, with editing in place and repeating reminders. */
import { api, type Note, type Reminder, type Repeat } from "../api";
import { el, icon, iconButton } from "../dom";
import { refreshBrief } from "../state";
import { showToast } from "../toast";
import { whenShort } from "./brain-model";
import { btn, chip, emptyState, pageHead } from "./kit";
import { REPEAT_LABEL, REPEAT_OPTIONS, buildTasks, defaultReminderTime, toLocalInput, type TaskFilter } from "./tasks-model";

type Kind = "todo" | "note" | "reminder";
const KINDS: [Kind, string][] = [["todo", "Дело"], ["reminder", "Напоминание"], ["note", "Заметка"]];
/** Kept across re-renders of the page: the chosen filter, the search and the kind of the new entry. */
const UI = { filter: "all" as TaskFilter, query: "", kind: "todo" as Kind };

function repeatSelect(value: Repeat | undefined, label: string): HTMLSelectElement {
  const s = el("select", { cls: "mem-select", attrs: { "aria-label": label } }, ...REPEAT_OPTIONS.map(([v, t]) => el("option", { value: v, textContent: t })));
  s.value = value ?? "none";
  return s;
}
const fromLocal = (v: string): string | null => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

export function tasksPage(): HTMLElement {
  let data: { notes: Note[]; reminders: Reminder[] } | null = null;
  let loadError = "";
  /** The entry being edited, so a reload (after another change) keeps the editor open. */
  let editing: string | null = null;
  let detailId: string | null = null;
  const listHost = el("div", { cls: "tasks-list", attrs: { "aria-live": "polite" } });
  const chipsHost = el("div", { cls: "chips", attrs: { role: "group", "aria-label": "Что показать" } });
  const planHost = el("section", { cls:"pg-card",attrs:{"aria-label":"План дня"} }, el("p",{cls:"muted",textContent:"План дня загружается…"}));

  const month = el("input", { type:"month",value:new Date().toISOString().slice(0,7),cls:"mem-select",attrs:{"aria-label":"Месяц календаря"} });
  const calendarHost = el("section",{cls:"pg-card",attrs:{"aria-label":"Календарь и продуктивность"}});
  const renderInsights = async () => {
    const r = await api.taskInsights(month.value);
    if (!r.ok) { calendarHost.replaceChildren(el("p",{cls:"muted",textContent:"Календарь временно недоступен"})); return; }
    const {statistics:stats, items,brainRecommendations} = r.value;
    const days = new Map<string, typeof items>();
    for(const item of items){const day=item.at.slice(0,10);days.set(day,[...(days.get(day)??[]),item]);}
    calendarHost.replaceChildren(
      el("h2",{textContent:"Календарь · "+month.value}),
      el("p",{cls:"muted small",textContent:`Выполнено: ${stats.completed} из ${stats.all} (${stats.completionPercent}%) · За месяц: ${stats.completedThisMonth} · Просрочено: ${stats.overdue}`}),
      el("ul",{cls:"org-list"},...[...days.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([day,entries])=>
        el("li",{cls:"org-row"},el("span",{cls:"br-tag",textContent:day}),
          el("span",{cls:"grow",textContent:entries.map(x=>(x.done?"✓ ":"")+x.text).join(" · ").slice(0,450)})))),
      el("h3",{textContent:"Рекомендации JUUNIBI · Brain"}),
      el("p",{cls:"muted small",textContent:"Основаны на реальных сроках и приоритетах. Дела не меняются автоматически."}),
      el("ul",{cls:"org-list"},...brainRecommendations.map(x=>
        el("li",{cls:"org-row"},el("span",{cls:"grow",textContent:x.text}),el("span",{cls:"br-tag",textContent:x.reason})))));
  };
  month.addEventListener("change",()=>void renderInsights());
  const load = async () => {
    const r = await api.organizer();
    if (r.ok) { data = r.value; loadError = ""; } else loadError = r.error.message;
    render();
    void renderInsights();
    const plan = await api.taskPlan();
    if (plan.ok) {
      const v = plan.value;
      planHost.replaceChildren(el("h2",{textContent:"План дня · рекомендовано"}),
        el("p",{cls:"muted small",textContent:`Открыто: ${v.total} · Просрочено: ${v.overdue} · Оценка: ${v.estimatedMinutes} мин`}),
        el("ul",{cls:"org-list"},...v.suggested.map(x=>el("li",{cls:"org-row"},el("span",{cls:"grow",textContent:x.text}),el("span",{cls:"br-tag",textContent:x.reason})) )));
    } else planHost.replaceChildren(el("p",{cls:"muted",textContent:"План дня временно недоступен"}));
  };
  /** Runs a change, reports a failure, reloads the list and the reminder badge on Home. */
  const act = async (run: () => Promise<{ ok: boolean; error?: { message: string } }>, ok?: string) => {
    const r = await run();
    if (!r.ok) showToast(r.error?.message ?? "Не получилось", { ms: 8000 });
    else if (ok) showToast(ok, { ms: 2500 });
    await load();
    void refreshBrief();
    return r.ok;
  };

  // ---------- adding ----------
  const text = el("input", { type: "text", maxLength: 500, cls: "mem-input", attrs: { "aria-label": "Текст новой записи" } });
  const at = el("input", { type: "datetime-local", cls: "mem-select", value: defaultReminderTime(), attrs: { "aria-label": "Когда напомнить" } });
  const repeat = repeatSelect(undefined, "Повтор");
  const when_ = el("div", { cls: "tasks-when" }, at, repeat);
  const add = btn("Добавить", () => {}, { primary: true, icon: "plus" });
  add.type = "submit";
  const kinds = el("div", { cls: "segmented", attrs: { role: "radiogroup", "aria-label": "Что добавить" } });
  const syncKind = () => {
    kinds.replaceChildren(...KINDS.map(([k, label]) => {
      const b = el("button", { type: "button", textContent: label, attrs: { role: "radio", "aria-checked": String(UI.kind === k) } });
      b.addEventListener("click", () => { UI.kind = k; syncKind(); text.focus(); });
      return b;
    }));
    when_.hidden = UI.kind !== "reminder";
    text.placeholder = UI.kind === "todo" ? "Например: купить хлеб" : UI.kind === "note" ? "Например: код домофона 1234" : "Например: позвонить маме";
  };
  syncKind();
  const form = el("form", { cls: "tasks-add" }, kinds, el("div", { cls: "tasks-add-row" }, text, when_, add));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = text.value.trim();
    if (!t) { text.focus(); return; }
    add.disabled = true;
    let ok: boolean;
    if (UI.kind === "reminder") {
      const iso = fromLocal(at.value);
      if (!iso) { add.disabled = false; showToast("Укажите дату и время."); at.focus(); return; }
      const rep = repeat.value === "none" ? undefined : repeat.value as Repeat;
      ok = await act(() => api.addReminder(t, iso, rep), rep ? `Напоминание поставлено: ${REPEAT_LABEL[rep]}` : "Напоминание поставлено");
    } else ok = await act(() => api.addNote(UI.kind === "note" ? "note" : "todo", t), UI.kind === "note" ? "Заметка добавлена" : "Дело добавлено");
    add.disabled = false;
    if (ok) { text.value = ""; repeat.value = "none"; at.value = defaultReminderTime(); text.focus(); }
  });

  // ---------- rows ----------
  const editor = (initial: string, extra: HTMLElement[], save: (t: string) => Promise<boolean>) => {
    const input = el("input", { type: "text", maxLength: 500, value: initial, cls: "mem-input", attrs: { "aria-label": "Текст" } });
    const ok = btn("Сохранить", async () => { const v = input.value.trim(); if (!v) { input.focus(); return; } ok.disabled = true; if (await save(v)) editing = null; render(); }, { small: true, primary: true });
    const cancel = btn("Отмена", () => { editing = null; render(); }, { small: true });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } else if (e.key === "Escape") { e.preventDefault(); cancel.click(); } });
    queueMicrotask(() => { input.focus(); input.select(); });
    return el("li", { cls: "org-row editing" }, el("div", { cls: "tasks-edit" }, input, ...extra, el("div", { cls: "row" }, ok, cancel)));
  };
  const taskDetails = (n: Note): HTMLElement => {
    const priority = el("select", { cls:"mem-select", attrs:{"aria-label":"Приоритет"} },
      ...([["low","Низкий"],["normal","Обычный"],["high","Высокий"]] as const).map(([v,label])=>el("option",{value:v,textContent:label})));
    priority.value = n.priority ?? "normal";
    const due = el("input",{type:"datetime-local",cls:"mem-select",value:n.dueAt?toLocalInput(n.dueAt):"",attrs:{"aria-label":"Срок выполнения"}});
    const project = el("input",{type:"text",maxLength:80,value:n.project??"",cls:"mem-input",placeholder:"Проект",attrs:{"aria-label":"Проект"}});
    const estimate = el("input",{type:"number",min:"1",max:"1440",value:n.estimateMinutes?String(n.estimateMinutes):"",cls:"mem-input",placeholder:"Минуты",attrs:{"aria-label":"Оценка в минутах"}});
    const parents = data?.notes.filter(x=>x.kind==="todo"&&x.id!==n.id&&!x.parentId)??[];
    const parent = el("select",{cls:"mem-select",attrs:{"aria-label":"Подзадача дела"}},
      el("option",{value:"",textContent:"Без родительского дела"}),
      ...parents.map(x=>el("option",{value:x.id,textContent:x.text.slice(0,70)})));
    parent.value=n.parentId??"";
    return el("div",{cls:"tasks-edit"},
      el("div",{cls:"tasks-add-row"},priority,due,project,estimate,parent),
      btn("Сохранить план",()=>void act(()=>api.updateTask(n.id,{
        priority:priority.value as NonNullable<Note["priority"]>, dueAt:due.value?fromLocal(due.value):null,
        project:project.value.trim()||null, estimateMinutes:estimate.value?Number(estimate.value):null,
        parentId:parent.value||null
      }),"Параметры дела сохранены"),{small:true,primary:true}));
  };
  const noteRow = (n: Note): HTMLElement => {
    if (editing === n.id) return editor(n.text, [], (t) => act(() => api.editNote(n.id, t), "Сохранено"));
    const box = n.kind === "todo"
      ? el("input", { type: "checkbox", checked: n.done, attrs: { "aria-label": (n.done ? "Вернуть в работу: " : "Выполнено: ") + n.text } })
      : el("span", { cls: "org-ic", attrs: { "aria-hidden": "true" } }, icon("edit", 16));
    if (box instanceof HTMLInputElement) box.addEventListener("change", () => void act(() => api.setTodoDone(n.id, box.checked), box.checked ? "Готово" : undefined));
    return el("li", { cls: "org-row" + (n.done ? " done" : "") }, box,
      el("span", { cls: "grow", textContent: n.text }),
      el("span", { cls: "muted small tasks-age", textContent: n.kind==="todo" ? [n.priority==="high"?"⚑ Важно":null,n.dueAt?new Date(n.dueAt).toLocaleDateString("ru-RU"):null,n.project,n.estimateMinutes? n.estimateMinutes+" мин":null].filter(Boolean).join(" · ") || "Без срока" : new Date(n.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) }),
      n.kind==="todo" ? iconButton("settings","Параметры дела",()=>{ detailId = detailId===n.id?null:n.id; render(); },"icon-btn sm") : null,
      n.done ? null : iconButton("edit", "Изменить: " + n.text, () => { editing = n.id; render(); }, "icon-btn sm"),
      iconButton("trash", "Удалить: " + n.text, () => { if (confirm("Удалить запись?")) void act(() => api.removeNote(n.id), "Удалено"); }, "icon-btn sm"));
  };
  const reminderRow = (r: Reminder): HTMLElement => {
    if (editing === r.id && r.status === "scheduled") {
      const time = el("input", { type: "datetime-local", cls: "mem-select", value: toLocalInput(r.at), attrs: { "aria-label": "Когда напомнить" } });
      const rep = repeatSelect(r.repeat, "Повтор");
      return editor(r.text, [time, rep], (t) => {
        const iso = fromLocal(time.value);
        if (!iso) { showToast("Укажите дату и время."); return Promise.resolve(false); }
        return act(() => api.editReminder(r.id, { text: t, at: iso, repeat: rep.value as Repeat | "none" }), "Сохранено");
      });
    }
    const tags = [
      el("span", { cls: "br-tag" + (r.status === "due" ? " warn" : ""), textContent: r.status === "due" ? "сработало " + whenShort(r.firedAt ?? r.at) : whenShort(r.at) }),
      r.repeat ? el("span", { cls: "br-tag ok", title: "Повторяется", textContent: "↻ " + REPEAT_LABEL[r.repeat] }) : null,
    ];
    return el("li", { cls: "org-row" + (r.status === "due" ? " due" : r.status === "done" ? " done" : "") },
      el("span", { cls: "org-ic", attrs: { "aria-hidden": "true" } }, icon("clock", 16)),
      el("span", { cls: "grow", textContent: r.text }), ...tags,
      r.status === "due" ? btn("Готово", () => void act(() => api.dismissReminder(r.id)), { small: true, primary: true }) : null,
      r.status === "scheduled" ? iconButton("edit", "Изменить напоминание: " + r.text, () => { editing = r.id; render(); }, "icon-btn sm") : null,
      iconButton("trash", r.repeat ? "Удалить повторяющееся напоминание" : "Удалить напоминание", () => {
        if (!r.repeat || confirm("Удалить повторяющееся напоминание? Оно больше не сработает.")) void act(() => api.removeReminder(r.id), "Удалено");
      }, "icon-btn sm"));
  };
  const group = (title: string, rows: HTMLElement[], cls = "") => rows.length ? el("section", { cls: "tasks-group " + cls }, el("h2", { textContent: title }), el("ul", { cls: "org-list" }, ...rows)) : null;

  function render() {
    if (!data) { listHost.replaceChildren(loadError ? emptyState("alert", "Не удалось загрузить", loadError, btn("Повторить", () => void load(), { small: true })) : el("p", { cls: "muted", textContent: "Загрузка…" })); return; }
    const t = buildTasks(data, UI.filter, UI.query);
    const c = t.counts;
    const opts: [TaskFilter, string, number][] = [["all", "Все", c.all], ["todo", "Дела", c.todo], ["reminder", "Напоминания", c.reminder], ["note", "Заметки", c.note]];
    chipsHost.replaceChildren(...opts.map(([f, label, n]) => chip(label, n, UI.filter === f, () => { UI.filter = f; render(); })));
    const finished = [...t.finished.todos.map(noteRow), ...t.finished.reminders.map(reminderRow)];
    const taskDetailsOpen = detailId && data.notes.find(n=>n.id===detailId&&n.kind==="todo");
    const groups = [
      group(`Сработали · ${t.due.length}`, t.due.map(reminderRow), "due"),
      group(`Дела · ${t.todos.length}`, t.todos.map(noteRow)),
      group(`Напоминания · ${t.reminders.length}`, t.reminders.map(reminderRow)),
      group(`Заметки · ${t.notes.length}`, t.notes.map(noteRow)),
    ].filter((g): g is HTMLElement => !!g);
    const done = finished.length ? el("details", { cls: "br-fold tasks-done" }, el("summary", { textContent: `Выполненные · ${finished.length}` }), el("ul", { cls: "org-list" }, ...finished)) : null;
    if (!groups.length && !done) {
      listHost.replaceChildren(UI.query || UI.filter !== "all"
        ? emptyState("search", "Ничего не найдено", "Измените запрос или фильтр.")
        : emptyState("check", "Пока пусто", "Добавьте дело или напоминание выше. Можно и в чате: «Напоминай каждый будний день в 10:00 про стендап»: помощница поставит его после вашего подтверждения."));
      return;
    }
    listHost.replaceChildren(...(taskDetailsOpen ? [el("section",{cls:"pg-card"},el("h2",{textContent:"Параметры: "+taskDetailsOpen.text}),taskDetails(taskDetailsOpen))] : []), ...groups, ...(done ? [done] : []));
  }

  const search = el("input", { type: "search", placeholder: "Поиск", value: UI.query, cls: "mem-search", attrs: { "aria-label": "Поиск по делам и заметкам" } });
  search.addEventListener("input", () => { UI.query = search.value; render(); });
  const perm = typeof Notification !== "undefined" && Notification.permission === "default"
    ? btn("Включить уведомления", async () => { await Notification.requestPermission(); perm?.remove(); }, { small: true, icon: "alert", title: "Показывать напоминания уведомлениями системы" }) : null;

  render();
  void load();
  return el("div", { cls: "page tasks-page" },
    pageHead("check", "Дела", "Дела, заметки и напоминания. Напоминания срабатывают, пока JUUNIBI запущен."),
    el("section", { cls: "pg-card" }, form),
    planHost,
    el("section",{cls:"pg-card"},el("label",{textContent:"Месяц календаря"}),month),
    calendarHost,
    el("div", { cls: "mem-toolbar" }, search, chipsHost, perm),
    listHost);
}
