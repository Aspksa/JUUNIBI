import { ACCENTS, swatchColor } from "../accents";
import { api, type AssistantSettings } from "../api";
import type { Chats } from "../chat/chats";
import { formatBytes } from "../chat/helpers";
import { el, icon, iconButton, short } from "../dom";
import { app, persistPrefs, refreshStatus, type AppState, type Theme } from "../state";
import { btn, dot, pageHead, section } from "./kit";
import { toggle } from "./modules-parts";

const KEY_FLASH = { text: "", bad: false };

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

const BEH_FLASH = { text: "", bad: false };
const SUGGEST_MODES: ["off" | "rules" | "smart", string, string][] = [["off", "Выкл", "Ничего не предлагает"], ["rules", "По фразам", "Только после «Запомни…», «Я предпочитаю…», «Меня зовут…»"], ["smart", "Умно", "Ещё и модель выделяет факты из ваших слов"]];

/** What the assistant may do and how it behaves. Everything here only ever NARROWS or tunes; memory entries still need your "Принять". */
function behaviorSection(s: AppState): HTMLElement {
  const cfg = s.assistantSettings;
  if (!cfg) return section("Поведение помощницы", el("p", { cls: "muted", textContent: "Загрузка…" }));
  const flash = el("p", { cls: "flash" + (BEH_FLASH.bad ? " bad" : ""), attrs: { role: "status" }, textContent: BEH_FLASH.text });
  const save = async (patch: Partial<AssistantSettings>, ok = "Сохранено."): Promise<boolean> => {
    const r = await api.saveAssistantSettings(patch);
    BEH_FLASH.bad = !r.ok; BEH_FLASH.text = r.ok ? ok : r.error.message;
    flash.className = "flash" + (r.ok ? "" : " bad"); flash.textContent = BEH_FLASH.text;
    if (r.ok) app.set({ assistantSettings: r.value });
    return r.ok;
  };

  // chat model, fallback and reasoning
  const listId = "cloud-models";
  const options = el("datalist", { id: listId });
  const chatModel = el("input", { type: "text", value: cfg.chat.model, spellcheck: false, attrs: { "aria-label": "Модель чата", list: listId } });
  const fallback = el("input", { type: "text", value: cfg.chat.fallbackModel, placeholder: "Не задана", spellcheck: false, attrs: { "aria-label": "Запасная модель", list: listId } });
  const modelsNote = el("p", { cls: "muted small", attrs: { role: "status" } });
  const loadModels = btn("Загрузить список моделей", async () => {
    loadModels.disabled = true; modelsNote.textContent = "Запрашиваю список у Cloud.ru…";
    const r = await api.cloudModels();
    loadModels.disabled = false;
    if (!r.ok) { modelsNote.textContent = r.error.message; return; }
    options.replaceChildren(...r.value.models.map((id) => el("option", { value: id })));
    modelsNote.textContent = r.value.models.length ? `Доступно моделей: ${r.value.models.length}. Начните вводить имя, чтобы выбрать.` : "Cloud.ru не вернул ни одной модели.";
  }, { small: true });
  const saveChat = btn("Сохранить модели", () => void save({ chat: { model: chatModel.value.trim(), fallbackModel: fallback.value.trim(), reasoning: cfg.chat.reasoning } }, "Модели сохранены."), { small: true, primary: true });
  const chatSub = el("div", { cls: "beh-sub" },
    el("label", { cls: "beh-field" }, el("span", { textContent: "Модель чата (Cloud.ru)" }), chatModel),
    el("label", { cls: "beh-field" }, el("span", { textContent: "Запасная модель: используется один раз, если основная не отвечает" }), fallback),
    options, el("div", { cls: "row" }, saveChat, loadModels), modelsNote);
  // semantic memory search
  const model = el("input", { type: "text", value: cfg.embeddings.model, spellcheck: false, attrs: { "aria-label": "Модель эмбеддингов" } });
  const probe = el("p", { cls: "muted small", attrs: { role: "status" } });
  const check = btn("Проверить", async () => {
    check.disabled = true; probe.textContent = "Проверяю…";
    const r = await api.embeddingTest();
    check.disabled = false;
    probe.textContent = !r.ok ? r.error.message : r.value.ok ? `Работает: ответ за ${r.value.ms} мс, размерность ${r.value.dims}.` : "Не работает: " + (r.value.error ?? "нет ответа") + ". Память продолжит искать по словам.";
  }, { small: true });
  const saveModel = btn("Сохранить модель", () => void save({ embeddings: { enabled: cfg.embeddings.enabled, model: model.value.trim() } }, "Модель сохранена."), { small: true });
  const search = el("div", { cls: "beh-sub" }, el("label", { cls: "beh-field" }, el("span", { textContent: "Модель эмбеддингов (Cloud.ru)" }), model), el("div", { cls: "row" }, saveModel, check), probe);
  // proposals
  const modes = el("div", { cls: "segmented", attrs: { role: "radiogroup", "aria-label": "Предлагать запомнить" } }, ...SUGGEST_MODES.map(([v, label, hint]) => {
    const b = el("button", { type: "button", textContent: label, title: hint, attrs: { role: "radio", "aria-checked": String(cfg.suggestions === v) } });
    b.addEventListener("click", () => void save({ suggestions: v }));
    return b;
  }));
  // files
  const root = el("input", { type: "text", value: cfg.files.root, placeholder: "Например: C:\\Users\\Я\\Документы\\Заметки", spellcheck: false, attrs: { "aria-label": "Папка для чтения" } });
  const saveRoot = btn("Сохранить папку", () => void save({ files: { root: root.value.trim(), allowWrite: cfg.files.allowWrite } }, root.value.trim() ? "Папка выбрана." : "Доступ к файлам закрыт."), { small: true });
  const files = el("div", { cls: "beh-sub" }, el("label", { cls: "beh-field" }, el("span", { textContent: "Папка, которую помощница может читать" }), root),
    el("div", { cls: "row" }, saveRoot, ...(cfg.files.root ? [btn("Закрыть доступ", () => void save({ files: { root: "", allowWrite: false } }, "Доступ к файлам закрыт."), { small: true })] : [])),
    el("p", { cls: "muted small", textContent: "Только чтение текстовых файлов до 200 КБ. Секреты (.env, ключи), папки .git и node_modules, а также ссылки наружу закрыты." }));
  // quick commands
  const qName = el("input", { type: "text", maxLength: 24, placeholder: "итоги", attrs: { "aria-label": "Имя команды" } });
  const qText = el("input", { type: "text", maxLength: 2000, placeholder: "Подведи итоги дня", attrs: { "aria-label": "Текст команды" } });
  const qAdd = btn("Добавить", async () => {
    if (!qName.value.trim() || !qText.value.trim()) return;
    if (await save({ quickCommands: [...cfg.quickCommands, { name: qName.value.trim(), text: qText.value.trim() }] }, `Команда /${qName.value.trim().toLowerCase().replace(/^\//, "")} добавлена.`)) { qName.value = ""; qText.value = ""; }
  }, { small: true, primary: true });
  const quick = el("div", { cls: "beh-sub" },
    ...(cfg.quickCommands.length ? [el("ul", { cls: "beh-quick" }, ...cfg.quickCommands.map((c) => el("li", {}, el("code", { textContent: "/" + c.name }), el("span", { cls: "grow muted", textContent: c.text }),
      iconButton("trash", "Удалить /" + c.name, () => void save({ quickCommands: cfg.quickCommands.filter((x) => x.name !== c.name) }, "Команда удалена."), "icon-btn sm"))))] : [el("p", { cls: "muted small", textContent: "Быстрых команд пока нет." })]),
    el("div", { cls: "beh-add" }, el("label", { cls: "beh-field" }, el("span", { textContent: "Команда" }), qName), el("label", { cls: "beh-field grow" }, el("span", { textContent: "Что отправить" }), qText), qAdd));

  return section("Поведение помощницы",
    el("p", { cls: "muted small", textContent: "Настройки хранятся на этом компьютере. Они только ограничивают или настраивают помощницу: записи в память и действия по-прежнему требуют вашего подтверждения." }),
    el("div", { cls: "set-row stack" }, el("span", {}, el("strong", { textContent: "Модель" }), el("small", { cls: "muted", textContent: "Если Cloud.ru отвечает ошибкой 503, попробуйте другую модель или задайте запасную." })), chatSub),
    toggle("Размышления модели", "Модель сначала обдумывает ответ (пока видно «Обдумываю ответ»). Выключите, чтобы отвечала быстрее; работает не на всех моделях Cloud.ru.", cfg.chat.reasoning,
      (v) => save({ chat: { model: cfg.chat.model, fallbackModel: cfg.chat.fallbackModel, reasoning: v } })),
    toggle("Поиск по смыслу", "Память ищется не только по словам, но и по значению. При сбоях сам переключается на поиск по словам.", cfg.embeddings.enabled, (v) => save({ embeddings: { enabled: v, model: cfg.embeddings.model } })), search,
    el("div", { cls: "set-row stack" }, el("span", {}, el("strong", { textContent: "Предлагать запомнить" }), el("small", { cls: "muted", textContent: "Любое предложение попадает в «Ждут решения» и работает только после вашего «Принять»." })), modes),
    toggle("Сводка длинных бесед", "Начало долгого разговора сжимается в краткое содержание, чтобы помощница не теряла нить.", cfg.summaries, (v) => save({ summaries: v })),
    toggle("Справочник (Википедия)", "Помощница может искать и читать статьи русской Википедии и указывает ссылку на источник.", cfg.web, (v) => save({ web: v })),
    el("div", { cls: "set-row stack" }, el("span", {}, el("strong", { textContent: "Доступ к файлам" }), el("small", { cls: "muted", textContent: "Выберите одну папку: помощница сможет в ней читать и искать." })), files),
    toggle("Разрешить запись в эту папку", "Создание и замена текстовых документов (.md, .txt, .csv…). Каждый раз нужно ваше подтверждение; прежняя версия сохраняется в резервной копии.", cfg.files.allowWrite,
      (v) => save({ files: { root: cfg.files.root, allowWrite: v } }), !cfg.files.root),
    el("div", { cls: "set-row stack" }, el("span", {}, el("strong", { textContent: "Быстрые команды" }), el("small", { cls: "muted", textContent: "Короткое «/имя» в чате отправляет заготовленный текст." })), quick),
    flash);
}

export function settingsPage(s: AppState, chats: Chats): HTMLElement {
  const ok = !!s.status?.assistant;
  const model = s.status?.model ?? "";

  // ---- assistant connection
  const note = el("p", { cls: "flash" + (KEY_FLASH.bad ? " bad" : ""), attrs: { role: "status" }, textContent: KEY_FLASH.text });
  const key = el("input", { type: "password", name: "key", id: "cloud-key", autocomplete: "new-password", placeholder: ok ? "Вставьте новый ключ, чтобы заменить" : "Вставьте API-ключ Cloud.ru", required: true, spellcheck: false, cls: "key-input", attrs: { "aria-label": "API-ключ Cloud.ru" } });
  const eye = el("button", { type: "button", cls: "icon-btn", title: "Показать ключ", attrs: { "aria-label": "Показать ключ" } }, icon("eye", 18));
  eye.addEventListener("click", () => { const show = key.type === "password"; key.type = show ? "text" : "password"; eye.title = show ? "Скрыть ключ" : "Показать ключ"; });
  const save = btn(ok ? "Заменить ключ" : "Сохранить и подключить", () => {}, { primary: true });
  save.type = "submit";
  const form = el("form", { cls: "key-form" }, el("div", { cls: "key-field" }, key, eye), save);
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); save.disabled = true;
    const r = await api.cloudSave(key.value.trim());
    key.value = ""; save.disabled = false;
    KEY_FLASH.bad = !r.ok; KEY_FLASH.text = r.ok ? "Ключ сохранён локально. Помощница подключена." : r.error.message;
    note.className = "flash" + (KEY_FLASH.bad ? " bad" : ""); note.textContent = KEY_FLASH.text;
    if (r.ok) await refreshStatus();
  });
  const status = el("div", { cls: `conn ${ok ? "ok" : "off"}` }, dot(ok ? "ok" : "off"),
    el("div", { cls: "grow" }, el("strong", { textContent: ok ? "Помощница подключена" : s.status ? "Помощница не подключена" : "Проверка соединения…" }),
      el("span", { cls: "muted", textContent: ok ? `${model || "Cloud.ru"} · Cloud.ru Foundation Models` : "Без ключа чат не сможет отвечать." })));
  const assistant = section("Помощница", status,
    el("p", { cls: "muted small", textContent: "Ключ хранится только на этом компьютере (data/cloudru-settings.json), не в браузере и не в GitHub. Модель: DeepSeek V4 Flash." }), form, note);

  // ---- appearance
  const accents = el("div", { cls: "set-row stack" }, el("span", { textContent: "Акцентный цвет" }),
    el("div", { cls: "swatches", attrs: { role: "radiogroup", "aria-label": "Акцентный цвет" } }, ...ACCENTS.map((a) => {
      const b = el("button", { type: "button", cls: "swatch-pick", attrs: { role: "radio", "aria-checked": String(s.accent === a.id), "aria-label": a.label } }, el("i", { cls: "swatch" }), el("span", { textContent: a.label }));
      (b.firstChild as HTMLElement).style.background = swatchColor(a);
      b.addEventListener("click", () => { app.set({ accent: a.id }); persistPrefs(app.get()); });
      return b;
    })));
  const look = section("Внешний вид", themeCards(s), accents);

  // ---- chat
  const chat = section("Чат",
    segmented("Плотность", [["comfortable", "Свободно"], ["compact", "Компактно"]], s.chatDensity, (v) => app.set({ chatDensity: v })),
    segmented("Размер текста", [["sm", "Мелкий"], ["md", "Обычный"], ["lg", "Крупный"]], s.chatFont, (v) => app.set({ chatFont: v })),
    switchRow("Сцены персонажа", "Показывать описание действия и реплику над ответами", s.showScenes, (v) => app.set({ showScenes: v })));

  // ---- data
  const items = chats.store.get().items;
  const msgs = items.reduce((n, c) => n + c.messages.length, 0);
  const bytes = new Blob([JSON.stringify(items)]).size;
  const wipe = btn("Удалить все чаты", () => { if (confirm("Удалить всю историю чатов в этом браузере? Это нельзя отменить.")) { chats.clearAll(); wipe.textContent = "Удалено"; wipe.disabled = true; } }, { danger: true, icon: "trash", disabled: !items.length });
  const exp = btn("Экспорт (JSON)", () => {
    const blob = new Blob([JSON.stringify(chats.store.get().items, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "juunibi-chats.json" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, { icon: "download", disabled: !items.length });
  const data = section("Данные",
    el("p", { cls: "muted", textContent: `История чатов хранится только в этом браузере: ${items.length} чатов, ${msgs} сообщений, ${formatBytes(bytes)}.` }),
    el("div", { cls: "row" }, exp, wipe));

  // ---- about
  const link = el("a", { href: "https://github.com/Aspksa/JUUNIBI", target: "_blank", rel: "noopener noreferrer", textContent: "github.com/Aspksa/JUUNIBI" });
  const about = section("О программе",
    el("div", { cls: "about-grid" },
      el("span", { cls: "muted", textContent: "Версия" }), el("code", { textContent: short(s.update?.localVersion) }),
      el("span", { cls: "muted", textContent: "Исходный код" }), link,
      el("span", { cls: "muted", textContent: "Быстро открыть чат" }), el("span", {}, el("kbd", { cls: "kbd", textContent: "Ctrl" }), " + ", el("kbd", { cls: "kbd", textContent: "K" }))));

  return el("div", { cls: "page" }, pageHead("settings", "Настройки", "Подключение помощницы, внешний вид и ваши данные."), assistant, behaviorSection(s), look, chat, data, about);
}
