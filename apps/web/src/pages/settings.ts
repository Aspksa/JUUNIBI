import { ACCENTS, swatchColor } from "../accents";
import { api, type AssistantSettings } from "../api";
import type { Chats } from "../chat/chats";
import { formatBytes } from "../chat/helpers";
import { el, icon, iconButton, short, type IconName } from "../dom";
import { app, persistPrefs, refreshStatus, type AppState, type Theme } from "../state";
import { showToast } from "../toast";
import { btn, dot, pageHead } from "./kit";
import { toggle } from "./modules-parts";

const KEY_FLASH = { text: "", bad: false };
/** Models Cloud.ru returned, kept across re-renders so the list is asked for once. */
let cloudModels: string[] | null = null;
/** Removes the scroll listener of the previous render. */
let stopSpy: (() => void) | null = null;

type SectionId = "conn" | "model" | "memory" | "tools" | "quick" | "look" | "chat" | "data" | "about";
const SECTIONS: [SectionId, string, IconName][] = [
  ["conn", "Подключение", "cloud"], ["model", "Модель", "spark"], ["memory", "Память", "memory"], ["tools", "Инструменты", "puzzle"],
  ["quick", "Быстрые команды", "list"], ["look", "Внешний вид", "sun"], ["chat", "Чат", "chat"], ["data", "Данные", "folder"], ["about", "О программе", "book"],
];
const label = (id: SectionId) => SECTIONS.find((x) => x[0] === id)!;

/** A settings card: icon, title and a one-line explanation, then its rows. */
function card(id: SectionId, lead: string, ...kids: (Node | null)[]): HTMLElement {
  const [, title, ic] = label(id);
  return el("section", { cls: "pg-card set-card", id: "set-" + id, attrs: { "aria-labelledby": "set-h-" + id } },
    el("header", { cls: "set-card-head" }, el("span", { cls: "set-card-icon" }, icon(ic, 18)),
      el("div", { cls: "grow" }, el("h2", { id: "set-h-" + id, textContent: title }), el("p", { cls: "muted", textContent: lead }))),
    ...kids);
}

/** Sticky table of contents; highlights the card that is on screen. */
function toc(): HTMLElement {
  const links = SECTIONS.map(([id, title, ic]) => {
    const b = el("button", { type: "button", cls: "set-toc-link", attrs: { "data-id": id } }, icon(ic, 16), el("span", { textContent: title }));
    b.addEventListener("click", () => {
      const target = document.getElementById("set-" + id);
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      mark(id);
      pinned = Date.now() + 1200; // the smooth scroll must not move the highlight to a neighbour on its way
    });
    return b;
  });
  let pinned = 0;
  const nav = el("nav", { cls: "set-toc", attrs: { "aria-label": "Разделы настроек" } }, ...links);
  function mark(id: string) {
    for (const l of links) {
      const on = l.dataset.id === id;
      l.classList.toggle("active", on);
      if (on) l.setAttribute("aria-current", "true"); else l.removeAttribute("aria-current");
    }
  }
  mark("conn");
  stopSpy?.();
  stopSpy = null;
  setTimeout(() => {
    const scroller = nav.closest(".content");
    if (!scroller) return;
    const spy = () => {
      if (Date.now() < pinned) return;
      const top = scroller.getBoundingClientRect().top + 140;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let cur: string = "conn";
      for (const [id] of SECTIONS) { const s = document.getElementById("set-" + id); if (s && s.getBoundingClientRect().top <= top) cur = id; }
      mark(atEnd ? "about" : cur);
    };
    const unpin = () => { pinned = 0; };
    scroller.addEventListener("scroll", spy, { passive: true });
    for (const ev of ["wheel", "touchstart", "keydown"]) scroller.addEventListener(ev, unpin, { passive: true });
    spy();
    stopSpy = () => { scroller.removeEventListener("scroll", spy); for (const ev of ["wheel", "touchstart", "keydown"]) scroller.removeEventListener(ev, unpin); };
  });
  return nav;
}

const THEMES: [Theme, string, string][] = [["auto", "Как в системе", "Подстраивается под ОС"], ["light", "Светлая", "Для яркого освещения"], ["dark", "Тёмная", "Спокойная, по умолчанию"]];

function themeCards(s: AppState): HTMLElement {
  return el("div", { cls: "theme-cards", attrs: { role: "radiogroup", "aria-label": "Тема" } }, ...THEMES.map(([id, label, hint]) => {
    const b = el("button", { type: "button", cls: `theme-card ${id}`, attrs: { role: "radio", "aria-checked": String(s.theme === id) } },
      el("span", { cls: "mini" }, el("i", { cls: "mini-side" }), el("i", { cls: "mini-line a" }), el("i", { cls: "mini-line b" }), el("i", { cls: "mini-dot" })),
      el("strong", { textContent: label }), el("span", { cls: "muted", textContent: hint }));
    b.addEventListener("click", () => { app.set({ theme: id }); persistPrefs(app.get()); });
    return b;
  }));
}

function segmented<T extends string>(label: string, options: [T, string][], value: T, set: (v: T) => void): HTMLElement {
  return el("div", { cls: "set-row" }, el("span", { textContent: label }),
    el("div", { cls: "segmented", attrs: { role: "radiogroup", "aria-label": label } }, ...options.map(([v, t]) => {
      const b = el("button", { type: "button", textContent: t, attrs: { role: "radio", "aria-checked": String(value === v) } });
      b.addEventListener("click", () => { set(v); persistPrefs(app.get()); });
      return b;
    })));
}

function switchRow(label: string, hint: string, checked: boolean, set: (v: boolean) => void): HTMLElement {
  const i = el("input", { type: "checkbox", checked, attrs: { role: "switch" } });
  i.addEventListener("change", () => { set(i.checked); persistPrefs(app.get()); });
  return el("label", { cls: "set-row switch-row" }, el("span", { cls: "grow" }, el("strong", { textContent: label }), el("small", { cls: "muted", textContent: hint })), el("span", { cls: "switch" }, i));
}

/** A heading for a group of fields inside a card. */
const rowHead = (title: string, hint: string) => el("span", {}, el("strong", { textContent: title }), el("small", { cls: "muted", textContent: hint }));

/** Text field whose save button lights up only when the value differs from what is saved; Enter saves. */
function field(o: { label: string; value: string; placeholder?: string; list?: string; mono?: boolean; maxLength?: number }): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el("input", { type: "text", value: o.value, placeholder: o.placeholder ?? "", spellcheck: false, cls: o.mono ? "mono" : "", attrs: { "aria-label": o.label, ...(o.list ? { list: o.list } : {}) } });
  if (o.maxLength) input.maxLength = o.maxLength;
  return { wrap: el("label", { cls: "beh-field" }, el("span", { textContent: o.label }), input), input };
}
function dirtySave(inputs: HTMLInputElement[], saved: string[], text: string, run: () => void): HTMLButtonElement {
  const b = btn(text, run, { small: true, primary: true, disabled: true });
  const sync = () => { b.disabled = inputs.every((x, i) => x.value.trim() === saved[i]); };
  for (const x of inputs) {
    x.addEventListener("input", sync);
    x.addEventListener("keydown", (e) => { if (e.key === "Enter" && !b.disabled) { e.preventDefault(); b.click(); } });
  }
  return b;
}

const SUGGEST_MODES: ["off" | "rules" | "smart", string, string][] = [["off", "Выключено", "Ничего не предлагает."], ["rules", "По фразам", "После «Запомни…», «Я предпочитаю…», «Меня зовут…»."], ["smart", "Умно", "Ещё и модель сама замечает важные факты."]];

/** Cards for what the assistant may do. Everything here only ever NARROWS or tunes; memory entries still need your "Принять". */
function assistantCards(s: AppState): HTMLElement[] {
  const cfg = s.assistantSettings;
  if (!cfg) return (["model", "memory", "tools", "quick"] as const).map((id) => card(id, "Загружаю настройки помощницы…", el("div", { cls: "set-skeleton" }, el("i"), el("i"))));
  const save = async (patch: Partial<AssistantSettings>, ok = "Сохранено"): Promise<boolean> => {
    const r = await api.saveAssistantSettings(patch);
    showToast(r.ok ? ok : r.error.message, { ms: r.ok ? 3000 : 8000 });
    if (r.ok) app.set({ assistantSettings: r.value });
    return r.ok;
  };

  // ---- model
  const listId = "cloud-models";
  const options = el("datalist", { id: listId }, ...(cloudModels ?? []).map((id) => el("option", { value: id })));
  const chatModel = field({ label: "Основная модель", value: cfg.chat.model, list: listId, mono: true });
  const fallback = field({ label: "Запасная модель", value: cfg.chat.fallbackModel, placeholder: "Не задана", list: listId, mono: true });
  const modelsNote = el("p", { cls: "muted small", attrs: { role: "status" }, textContent: cloudModels ? `В списке ${cloudModels.length} моделей Cloud.ru: начните вводить имя.` : "" });
  const loadModels = async () => {
    reload.disabled = true; modelsNote.textContent = "Запрашиваю список у Cloud.ru…";
    const r = await api.cloudModels();
    reload.disabled = false;
    if (!r.ok) { modelsNote.textContent = r.error.message; return; }
    cloudModels = r.value.models;
    options.replaceChildren(...cloudModels.map((id) => el("option", { value: id })));
    modelsNote.textContent = cloudModels.length ? `В списке ${cloudModels.length} моделей Cloud.ru: начните вводить имя.` : "Cloud.ru не вернул ни одной модели.";
  };
  const reload = btn(cloudModels ? "Обновить список" : "Загрузить список моделей", () => void loadModels(), { small: true, icon: "refresh" });
  // the list is fetched the first time a model field gets focus, so picking a model needs no extra click
  if (!cloudModels && s.status?.assistant) for (const f of [chatModel.input, fallback.input]) f.addEventListener("focus", () => { if (!cloudModels && !reload.disabled) void loadModels(); }, { once: true });
  const saveModels = dirtySave([chatModel.input, fallback.input], [cfg.chat.model, cfg.chat.fallbackModel], "Сохранить", () => {
    const main = chatModel.input.value.trim(), fb = fallback.input.value.trim();
    if (!main) { showToast("Укажите основную модель."); chatModel.input.focus(); return; }
    if (fb && fb === main) { showToast("Запасная модель совпадает с основной: выберите другую или оставьте поле пустым."); fallback.input.focus(); return; }
    void save({ chat: { model: main, fallbackModel: fb, reasoning: cfg.chat.reasoning } }, "Модели сохранены");
  });
  const modelCard = card("model", "Какая модель Cloud.ru отвечает в чате. Если она перегружена (ошибка 503), выручит запасная.",
    el("div", { cls: "set-grid2" }, chatModel.wrap, fallback.wrap),
    el("p", { cls: "muted small", textContent: "Запасная модель пробуется один раз, если основная не ответила." }),
    options, el("div", { cls: "row" }, saveModels, reload), modelsNote,
    toggle("Размышления модели", "Модель сначала обдумывает ответ (пока видно «Обдумываю ответ»). Выключите, чтобы отвечала быстрее; работает не на всех моделях.", cfg.chat.reasoning,
      (v) => save({ chat: { model: cfg.chat.model, fallbackModel: cfg.chat.fallbackModel, reasoning: v } }, v ? "Размышления включены" : "Размышления выключены")));

  // ---- memory
  const emb = field({ label: "Модель эмбеддингов", value: cfg.embeddings.model, mono: true });
  const probe = el("p", { cls: "muted small", attrs: { role: "status" } });
  const check = btn("Проверить", async () => {
    check.disabled = true; probe.textContent = "Проверяю…"; probe.className = "muted small";
    const r = await api.embeddingTest();
    check.disabled = false;
    const good = r.ok && r.value.ok;
    probe.className = "small " + (good ? "ok-text" : "bad-text");
    probe.textContent = !r.ok ? r.error.message : r.value.ok ? `Работает: ответ за ${r.value.ms} мс, размерность ${r.value.dims}.` : "Не работает: " + (r.value.error ?? "нет ответа") + ". Память продолжит искать по словам.";
  }, { small: true, icon: "circleCheck" });
  const saveEmb = dirtySave([emb.input], [cfg.embeddings.model], "Сохранить", () => void save({ embeddings: { enabled: cfg.embeddings.enabled, model: emb.input.value.trim() } }, "Модель сохранена"));
  const embSub = el("div", { cls: "set-sub" }, emb.wrap, el("div", { cls: "row" }, saveEmb, check), probe);
  embSub.hidden = !cfg.embeddings.enabled;
  const modes = el("div", { cls: "choice-cards", attrs: { role: "radiogroup", "aria-label": "Предлагать запомнить" } }, ...SUGGEST_MODES.map(([v, title, hint]) => {
    const b = el("button", { type: "button", cls: "choice-card", attrs: { role: "radio", "aria-checked": String(cfg.suggestions === v) } }, el("strong", { textContent: title }), el("span", { cls: "muted", textContent: hint }));
    b.addEventListener("click", () => { if (cfg.suggestions !== v) void save({ suggestions: v }, `Предлагать запомнить: ${title.toLowerCase()}`); });
    return b;
  }));
  const memoryCard = card("memory", "Как помощница ищет в памяти и что предлагает запомнить. В память ничего не попадает без вашего «Принять».",
    toggle("Поиск по смыслу", "Ищет не только по словам, но и по значению. При сбоях сам переключается на поиск по словам.", cfg.embeddings.enabled,
      (v) => save({ embeddings: { enabled: v, model: cfg.embeddings.model } }, v ? "Поиск по смыслу включён" : "Поиск по смыслу выключен")),
    embSub,
    el("div", { cls: "set-row stack" }, rowHead("Предлагать запомнить", "Предложения появляются в «Ждут решения»."), modes),
    toggle("Сводка длинных бесед", "Начало долгого разговора сжимается в краткое содержание, чтобы помощница не теряла нить.", cfg.summaries, (v) => save({ summaries: v }, v ? "Сводки включены" : "Сводки выключены")));

  // ---- tools: Wikipedia and one folder
  const root = field({ label: "Папка", value: cfg.files.root, placeholder: "Например: C:\\Users\\Я\\Документы\\Заметки", mono: true });
  const saveRoot = dirtySave([root.input], [cfg.files.root], cfg.files.root ? "Сменить папку" : "Открыть доступ", () => void save({ files: { root: root.input.value.trim(), allowWrite: root.input.value.trim() ? cfg.files.allowWrite : false } }, root.input.value.trim() ? "Папка выбрана" : "Доступ к файлам закрыт"));
  const access = cfg.files.root
    ? el("div", { cls: "set-badge ok" }, icon("folder", 16), el("span", { cls: "grow" }, "Открыт доступ к ", el("code", { textContent: cfg.files.root })),
      btn("Закрыть", () => void save({ files: { root: "", allowWrite: false } }, "Доступ к файлам закрыт"), { small: true }))
    : el("div", { cls: "set-badge" }, icon("shield", 16), el("span", { textContent: "Доступ к файлам закрыт. Укажите одну папку, чтобы помощница могла в ней читать и искать." }));
  const write = cfg.files.root ? toggle("Разрешить запись в эту папку", "Создание и замена текстовых документов (.md, .txt, .csv…). Каждый раз нужно ваше подтверждение; прежняя версия сохраняется в резервной копии.", cfg.files.allowWrite,
    (v) => save({ files: { root: cfg.files.root, allowWrite: v } }, v ? "Запись разрешена" : "Запись запрещена")) : null;
  const toolsCard = card("tools", "Что помощница может открыть сама. Каждый инструмент можно выключить.",
    toggle("Справочник (Википедия)", "Ищет и читает статьи русской Википедии и указывает ссылку на источник.", cfg.web, (v) => save({ web: v }, v ? "Справочник включён" : "Справочник выключен")),
    el("div", { cls: "set-row stack" }, rowHead("Доступ к файлам", "Только текстовые файлы до 200 КБ. Секреты (.env, ключи), .git, node_modules и ссылки наружу всегда закрыты."),
      el("div", { cls: "set-sub" }, access, el("div", { cls: "set-inline" }, root.wrap, saveRoot))),
    write);

  // ---- quick commands
  const NAME_RE = /^[\p{L}\p{N}_-]{1,24}$/u;
  let editing: string | null = null;
  const qName = field({ label: "Команда", value: "", placeholder: "итоги", maxLength: 25 });
  const qText = field({ label: "Что отправить", value: "", placeholder: "Подведи итоги дня", maxLength: 2000 });
  const qPrefix = el("span", { cls: "q-prefix", textContent: "/" });
  qName.input.before(qPrefix);
  qName.wrap.classList.add("q-name");
  qText.wrap.classList.add("grow");
  const qCancel = btn("Отмена", () => { editing = null; qName.input.value = ""; qText.input.value = ""; qAdd.lastChild!.textContent = "Добавить"; qCancel.hidden = true; }, { small: true });
  qCancel.hidden = true;
  const qAdd = btn("Добавить", async () => {
    const name = qName.input.value.trim().toLowerCase().replace(/^\//, ""), text = qText.input.value.trim();
    if (!name || !text) { showToast("Заполните имя команды и текст."); (name ? qText : qName).input.focus(); return; }
    if (!NAME_RE.test(name)) { showToast("Имя команды: до 24 букв, цифр, «-» или «_», без пробелов."); qName.input.focus(); return; }
    if (name !== editing && cfg.quickCommands.some((c) => c.name === name)) { showToast(`Команда /${name} уже есть.`); qName.input.focus(); return; }
    const list = editing ? cfg.quickCommands.map((c) => (c.name === editing ? { name, text } : c)) : [...cfg.quickCommands, { name, text }];
    if (await save({ quickCommands: list }, editing ? `Команда /${name} изменена` : `Команда /${name} добавлена`)) { editing = null; qName.input.value = ""; qText.input.value = ""; }
  }, { small: true, primary: true, icon: "plus" });
  for (const f of [qName.input, qText.input]) f.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); qAdd.click(); } });
  const quickList = cfg.quickCommands.length
    ? el("ul", { cls: "beh-quick" }, ...cfg.quickCommands.map((c) => el("li", {}, el("code", { textContent: "/" + c.name }), el("span", { cls: "grow muted", textContent: c.text, title: c.text }),
      iconButton("edit", "Изменить /" + c.name, () => { editing = c.name; qName.input.value = c.name; qText.input.value = c.text; qAdd.lastChild!.textContent = "Сохранить"; qCancel.hidden = false; qText.input.focus(); }, "icon-btn sm"),
      iconButton("trash", "Удалить /" + c.name, () => void save({ quickCommands: cfg.quickCommands.filter((x) => x.name !== c.name) }, `Команда /${c.name} удалена`), "icon-btn sm"))))
    : el("p", { cls: "set-empty muted small", textContent: "Команд пока нет. Например, «/итоги» может отправлять «Подведи итоги дня»." });
  const quickCard = card("quick", "Короткое «/имя» в чате отправляет заготовленный текст.",
    quickList, el("div", { cls: "beh-add" }, qName.wrap, qText.wrap, el("div", { cls: "row" }, qAdd, qCancel)));

  return [modelCard, memoryCard, toolsCard, quickCard];
}

export function settingsPage(s: AppState, chats: Chats): HTMLElement {
  const ok = !!s.status?.assistant;
  const model = s.assistantSettings?.chat.model || s.status?.model || "";

  // ---- assistant connection
  const note = el("p", { cls: "flash" + (KEY_FLASH.bad ? " bad" : ""), attrs: { role: "status" }, textContent: KEY_FLASH.text });
  const key = el("input", { type: "password", name: "key", id: "cloud-key", autocomplete: "new-password", placeholder: ok ? "Вставьте новый ключ, чтобы заменить" : "Вставьте API-ключ Cloud.ru", required: true, spellcheck: false, cls: "key-input", attrs: { "aria-label": "API-ключ Cloud.ru" } });
  const eye = el("button", { type: "button", cls: "icon-btn", title: "Показать ключ", attrs: { "aria-label": "Показать ключ", "aria-pressed": "false" } }, icon("eye", 18));
  eye.addEventListener("click", () => { const show = key.type === "password"; key.type = show ? "text" : "password"; eye.title = show ? "Скрыть ключ" : "Показать ключ"; eye.setAttribute("aria-pressed", String(show)); });
  const save = btn(ok ? "Заменить ключ" : "Сохранить и подключить", () => {}, { primary: true });
  save.type = "submit";
  save.disabled = true;
  key.addEventListener("input", () => { save.disabled = !key.value.trim(); });
  const form = el("form", { cls: "key-form" }, el("div", { cls: "key-field" }, key, eye), save);
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); save.disabled = true; save.lastChild!.textContent = "Проверяю…";
    const r = await api.cloudSave(key.value.trim());
    key.value = ""; save.lastChild!.textContent = ok ? "Заменить ключ" : "Сохранить и подключить";
    KEY_FLASH.bad = !r.ok; KEY_FLASH.text = r.ok ? "Ключ сохранён на этом компьютере. Помощница подключена." : r.error.message;
    note.className = "flash" + (KEY_FLASH.bad ? " bad" : ""); note.textContent = KEY_FLASH.text;
    if (r.ok) await refreshStatus();
  });
  const status = el("div", { cls: `conn ${ok ? "ok" : "off"}` }, el("span", { cls: "conn-icon" }, icon(ok ? "circleCheck" : "cloud", 22)),
    el("div", { cls: "grow" }, el("strong", { textContent: ok ? "Помощница подключена" : s.status ? "Помощница не подключена" : "Проверка соединения…" }),
      el("span", { cls: "muted", textContent: ok ? `Cloud.ru Foundation Models · ${model || "модель по умолчанию"}` : "Без ключа чат не сможет отвечать. Ключ выдаётся в личном кабинете Cloud.ru." })));
  const conn = card("conn", "Ключ Cloud.ru хранится только на этом компьютере (data/cloudru-settings.json), не в браузере и не в GitHub.",
    status, form, note);

  // ---- appearance
  const accents = el("div", { cls: "set-row stack" }, rowHead("Акцентный цвет", "Цвет кнопок, отметок и аватара."),
    el("div", { cls: "swatches", attrs: { role: "radiogroup", "aria-label": "Акцентный цвет" } }, ...ACCENTS.map((a) => {
      const b = el("button", { type: "button", cls: "swatch-pick", attrs: { role: "radio", "aria-checked": String(s.accent === a.id), "aria-label": a.label } }, el("i", { cls: "swatch" }), el("span", { textContent: a.label }));
      (b.firstChild as HTMLElement).style.background = swatchColor(a);
      b.addEventListener("click", () => { app.set({ accent: a.id }); persistPrefs(app.get()); });
      return b;
    })));
  const look = card("look", "Тема и цвет приложения. Меняются сразу, хранятся в этом браузере.", themeCards(s), accents);

  // ---- chat, with a live preview of density, text size and scenes
  const preview = el("div", { cls: ["chat-preview", s.chatDensity === "compact" ? "dens-compact" : "", s.chatFont !== "md" ? "font-" + s.chatFont : ""].filter(Boolean).join(" "), attrs: { "aria-hidden": "true" } },
    el("div", { cls: "cp-user" }, el("span", { textContent: "Что у меня на завтра?" })),
    s.showScenes ? el("div", { cls: "cp-scene", textContent: "Листает блокнот. «Сейчас посмотрю.»" }) : null,
    el("div", { cls: "cp-bot", textContent: "Завтра в 10:00 созвон с командой, а вечером вы хотели позвонить маме." }));
  const resetChat = s.chatDensity !== "comfortable" || s.chatFont !== "md" || !s.showScenes
    ? btn("Вернуть как было", () => { app.set({ chatDensity: "comfortable", chatFont: "md", showScenes: true }); persistPrefs(app.get()); }, { small: true, icon: "refresh" }) : null;
  const chat = card("chat", "Как выглядят сообщения в окне чата.",
    el("div", { cls: "set-split" },
      el("div", { cls: "grow" },
        segmented("Плотность", [["comfortable", "Свободно"], ["compact", "Компактно"]], s.chatDensity, (v) => app.set({ chatDensity: v })),
        segmented("Размер текста", [["sm", "Мелкий"], ["md", "Обычный"], ["lg", "Крупный"]], s.chatFont, (v) => app.set({ chatFont: v })),
        switchRow("Сцены персонажа", "Описание действия и реплика над ответами", s.showScenes, (v) => app.set({ showScenes: v }))),
      el("figure", { cls: "set-preview" }, el("figcaption", { cls: "muted small", textContent: "Так будет в чате" }), preview, resetChat)));

  // ---- data
  const items = chats.store.get().items;
  const msgs = items.reduce((n, c) => n + c.messages.length, 0);
  const bytes = new Blob([JSON.stringify(items)]).size;
  const stat = (n: string, t: string) => el("div", { cls: "set-stat" }, el("strong", { textContent: n }), el("span", { cls: "muted", textContent: t }));
  const wipe = btn("Удалить все чаты", () => {
    if (!confirm("Удалить всю историю чатов в этом браузере?")) return;
    const before = chats.store.get().items;
    chats.clearAll();
    showToast(`Удалено чатов: ${before.length}`, { action: { label: "Отменить", run: () => chats.restore(before) }, ms: 10000 });
  }, { danger: true, icon: "trash", disabled: !items.length });
  const exp = btn("Экспорт", () => {
    const blob = new Blob([JSON.stringify(chats.store.get().items, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `juunibi-chats-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, { icon: "download", disabled: !items.length, title: "Сохранить все чаты в файл JSON" });
  const file = el("input", { type: "file", accept: "application/json,.json", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files?.[0]; file.value = "";
    if (!f) return;
    let raw: unknown;
    try { raw = JSON.parse(await f.text()); } catch { showToast("Это не файл экспорта JUUNIBI: не удалось прочитать JSON."); return; }
    const n = chats.importJson(Array.isArray(raw) ? raw : (raw as { items?: unknown })?.items);
    showToast(n ? `Добавлено чатов: ${n}` : "Новых чатов в файле нет: все уже здесь или файл пуст.");
  });
  const imp = btn("Импорт", () => file.click(), { icon: "paperclip", title: "Добавить чаты из ранее сохранённого файла" });
  const data = card("data", "История чатов хранится только в этом браузере. Сохраните её в файл, чтобы перенести или не потерять.",
    el("div", { cls: "set-stats" }, stat(String(items.length), "чатов"), stat(String(msgs), "сообщений"), stat(formatBytes(bytes), "занимает")),
    el("div", { cls: "row" }, exp, imp, file, el("span", { cls: "grow" }), wipe));

  // ---- about
  const link = el("a", { href: "https://github.com/Aspksa/JUUNIBI", target: "_blank", rel: "noopener noreferrer", textContent: "github.com/Aspksa/JUUNIBI" });
  const version = short(s.update?.localVersion);
  const copy = iconButton("copy", "Скопировать версию", () => { void navigator.clipboard?.writeText(s.update?.localVersion ?? version).then(() => showToast("Версия скопирована", { ms: 2000 })); }, "icon-btn sm");
  const about = card("about", "Версия и полезные сочетания клавиш.",
    el("div", { cls: "about-grid" },
      el("span", { cls: "muted", textContent: "Версия" }), el("span", { cls: "row" }, el("code", { textContent: version }), copy, el("a", { href: "#/update", cls: "small", textContent: "Проверить обновления" })),
      el("span", { cls: "muted", textContent: "Исходный код" }), link,
      el("span", { cls: "muted", textContent: "Быстро открыть чат" }), el("span", {}, el("kbd", { cls: "kbd", textContent: "Ctrl" }), " + ", el("kbd", { cls: "kbd", textContent: "K" }))));

  const pill = el("a", { href: "#/settings", cls: `set-pill ${ok ? "ok" : "off"}` }, dot(ok ? "ok" : "off"), ok ? "Подключена" : "Не подключена");
  pill.addEventListener("click", (e) => { e.preventDefault(); document.getElementById("set-conn")?.scrollIntoView({ behavior: "smooth", block: "start" }); if (!ok) key.focus({ preventScroll: true }); });

  return el("div", { cls: "page settings-page" }, pageHead("settings", "Настройки", "Подключение помощницы, внешний вид и ваши данные.", pill),
    el("div", { cls: "set-layout" }, toc(), el("div", { cls: "set-main" }, conn, ...assistantCards(s), look, chat, data, about)));
}
