import { ACCENTS, fgFor, isHexColor, swatchColor } from "../accents";
import { api, type AssistantSettings, type SettingsPatch } from "../api";
import type { Chats } from "../chat/chats";
import { PLACEHOLDERS, formatBytes } from "../chat/helpers";
import { el, icon, iconButton, short, type IconName } from "../dom";
import { hotkeyTable, openHotkeys } from "../hotkeys";
import { app, persistPrefs, refreshStatus, type AppState, type Theme, type UiRadius, type UiScale } from "../state";
import { showToast } from "../toast";
import { btn, dot, pageHead } from "./kit";
import { toggle } from "./modules-parts";
import {
  BACKUP_PREFS, SECTIONS, STYLE_TEMPLATES, instructionsPreview, makeBackup, matches, move, parseBackup, readPagePrefs, sectionHealth, sectionOf, writePagePrefs,
  type CheckResult, type Health, type SectionId,
} from "./settings-parts";

const KEY_FLASH = { text: "", bad: false };
const MAX_INSTRUCTIONS = 1500;
const FLASH_KEY = "juunibi:settings:flash";
/** Models Cloud.ru returned, kept across re-renders so the list is asked for once. */
let cloudModels: string[] | null = null;
/** Unsaved text of the fields, so saving one card (which redraws the page) does not wipe what is typed in another. */
const drafts = new Map<string, string>();
/** Removes the scroll listener of the previous render. */
let stopSpy: (() => void) | null = null;
/** Results of the last «Проверить всё» (kept while the app is open) and whether one is running. */
let checks: CheckResult[] = [];
let checking = false;
/** Redraws the health dots of the current render (the check finishes after the page was drawn). */
let paintHealth: (() => void) | null = null;
/** The search field of the current render, for Ctrl+, */
let searchInput: HTMLInputElement | null = null;

/** Ctrl+, : the settings page opens (or is already open) and its search gets focus. */
export function focusSettingsSearch() {
  let tries = 0;
  const go = () => { if (searchInput?.isConnected) { searchInput.focus(); searchInput.select(); } else if (++tries < 20) setTimeout(go, 50); };
  setTimeout(go, 0);
}

// ---------------------------------------------------------------- building blocks

/** A settings card: a coloured icon tile, title and a one-line explanation; it can be collapsed and reset to defaults. */
function card(id: SectionId, lead: string, o: { reset?: (() => void) | undefined }, ...kids: (Node | null)[]): HTMLElement {
  const sec = sectionOf(id);
  const collapsed = readPagePrefs().collapsed.includes(id);
  const body = el("div", { cls: "set-card-body", id: "set-body-" + id }, ...kids);
  const chev = el("button", { type: "button", cls: "icon-btn sm set-collapse", title: collapsed ? "Развернуть" : "Свернуть",
    attrs: { "aria-expanded": String(!collapsed), "aria-controls": "set-body-" + id, "aria-label": (collapsed ? "Развернуть: " : "Свернуть: ") + sec.title } }, icon("chevron", 18));
  const section = el("section", { cls: `pg-card set-card tone-${sec.tone}${collapsed ? " collapsed" : ""}`, id: "set-" + id, attrs: { "aria-labelledby": "set-h-" + id, "data-title": sec.title } },
    el("header", { cls: "set-card-head" }, el("span", { cls: "set-card-icon" }, icon(sec.icon, 19)),
      el("div", { cls: "grow" }, el("h2", { id: "set-h-" + id, textContent: sec.title }), el("p", { cls: "muted", textContent: lead })),
      o.reset ? btn("По умолчанию", o.reset, { small: true, icon: "undo", title: `Вернуть раздел «${sec.title}» к исходным настройкам` }) : null, chev),
    body);
  body.hidden = collapsed;
  chev.addEventListener("click", () => setCollapsed(section, !section.classList.contains("collapsed")));
  section.querySelector("h2")!.addEventListener("click", () => { if (section.classList.contains("collapsed")) setCollapsed(section, false); });
  return section;
}
function setCollapsed(section: HTMLElement, on: boolean) {
  const id = section.id.replace("set-", "") as SectionId;
  section.classList.toggle("collapsed", on);
  const body = section.querySelector<HTMLElement>(".set-card-body")!;
  body.hidden = on;
  const chev = section.querySelector<HTMLButtonElement>(".set-collapse")!;
  const title = sectionOf(id).title;
  chev.setAttribute("aria-expanded", String(!on)); chev.title = on ? "Развернуть" : "Свернуть"; chev.setAttribute("aria-label", (on ? "Развернуть: " : "Свернуть: ") + title);
  const list = new Set(readPagePrefs().collapsed);
  if (on) list.add(id); else list.delete(id);
  writePagePrefs({ collapsed: [...list] });
  syncCollapseAll();
}
let syncCollapseAll = () => {};

/** Small coloured icon in front of a setting. */
const ic = (name: IconName) => el("span", { cls: "set-ic", attrs: { "aria-hidden": "true" } }, icon(name, 16));
/** A heading for a group of fields inside a card. */
const rowHead = (name: IconName, title: string, hint: string) => el("span", { cls: "set-rh" }, ic(name), el("span", {}, el("strong", { textContent: title }), el("small", { cls: "muted", textContent: hint })));
/** A switch row with an icon in front. */
function itoggle(name: IconName, ...a: Parameters<typeof toggle>): HTMLElement {
  const row = toggle(...a);
  row.prepend(ic(name));
  return row;
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

function segmented<T extends string>(name: IconName, label: string, hint: string, options: [T, string][], value: T, set: (v: T) => void): HTMLElement {
  return el("div", { cls: "set-row" }, rowHead(name, label, hint),
    el("div", { cls: "segmented", attrs: { role: "radiogroup", "aria-label": label } }, ...options.map(([v, t]) => {
      const b = el("button", { type: "button", textContent: t, attrs: { role: "radio", "aria-checked": String(value === v) } });
      b.addEventListener("click", () => { set(v); persistPrefs(app.get()); });
      return b;
    })));
}

function switchRow(name: IconName, label: string, hint: string, checked: boolean, set: (v: boolean) => void): HTMLElement {
  const i = el("input", { type: "checkbox", checked, attrs: { role: "switch" } });
  i.addEventListener("change", () => { set(i.checked); persistPrefs(app.get()); });
  return el("label", { cls: "set-row switch-row" }, ic(name), el("span", { cls: "grow" }, el("strong", { textContent: label }), el("small", { cls: "muted", textContent: hint })), el("span", { cls: "switch" }, i));
}

/** Text field whose save button lights up only when the value differs from what is saved; Enter saves. */
function field(o: { label: string; value: string; placeholder?: string; list?: string; mono?: boolean; maxLength?: number }): { wrap: HTMLElement; input: HTMLInputElement } {
  const draft = drafts.get(o.label);
  if (draft === o.value) drafts.delete(o.label);
  const input = el("input", { type: "text", value: draft ?? o.value, placeholder: o.placeholder ?? "", spellcheck: false, cls: o.mono ? "mono" : "", attrs: { "aria-label": o.label, ...(o.list ? { list: o.list } : {}) } });
  if (o.maxLength) input.maxLength = o.maxLength;
  input.addEventListener("input", () => { if (input.value === o.value) drafts.delete(o.label); else drafts.set(o.label, input.value); });
  return { wrap: el("label", { cls: "beh-field" }, el("span", { textContent: o.label }), input), input };
}
function dirtySave(inputs: (HTMLInputElement | HTMLTextAreaElement)[], saved: string[], text: string, run: () => void): HTMLButtonElement {
  // the values are being saved: they are no longer drafts (the redraw shows what the server kept)
  const b = btn(text, () => { for (const x of inputs) drafts.delete(x.getAttribute("aria-label") ?? ""); run(); }, { small: true, primary: true, disabled: true });
  const sync = () => { b.disabled = inputs.every((x, i) => x.value.trim() === saved[i]); };
  sync();
  for (const x of inputs) {
    x.addEventListener("input", sync);
    // Enter saves a one-line field; in a text area it starts a new line, Ctrl+Enter saves
    x.addEventListener("keydown", (ev) => { const e = ev as KeyboardEvent; if (e.key === "Enter" && !b.disabled && (x instanceof HTMLInputElement || e.ctrlKey || e.metaKey)) { e.preventDefault(); b.click(); } });
  }
  return b;
}

/** Server defaults, asked for the first time a «По умолчанию» button is pressed. */
let defaults: AssistantSettings | null = null;
async function withDefaults(run: (d: AssistantSettings) => void) {
  if (!defaults) { const r = await api.settingsDefaults(); if (!r.ok) { showToast(r.error.message); return; } defaults = r.value; }
  run(defaults);
}

// ---------------------------------------------------------------- side column: search + table of contents

function side(health: () => Partial<Record<SectionId, Health>>): HTMLElement {
  const links = SECTIONS.map((sec) => {
    const b = el("button", { type: "button", cls: `set-toc-link tone-${sec.tone}`, attrs: { "data-id": sec.id } }, icon(sec.icon, 16), el("span", { cls: "grow", textContent: sec.title }), el("i", { cls: "set-hdot" }));
    b.addEventListener("click", () => jump(sec.id));
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
  function jump(id: SectionId, target?: HTMLElement) {
    const sec = document.getElementById("set-" + id);
    if (!sec) return;
    if (sec.classList.contains("collapsed")) setCollapsed(sec, false);
    const goal = target ?? sec;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    goal.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: target ? "center" : "start" });
    mark(id);
    pinned = Date.now() + 1200; // the smooth scroll must not move the highlight to a neighbour on its way
  }
  paintHealth = () => {
    const h = health();
    for (const l of links) {
      const d = l.querySelector<HTMLElement>(".set-hdot")!;
      const v = h[l.dataset.id as SectionId];
      d.className = "set-hdot" + (v ? " " + v.tone : "");
      l.title = v ? v.why : "";
    }
  };
  paintHealth();

  // search: every setting row of the page, matched against its text and the section's keywords
  const input = el("input", { type: "search", id: "set-search", placeholder: "Найти…", autocomplete: "off", spellcheck: false, attrs: { "aria-label": "Поиск по настройкам", "aria-controls": "set-results", role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list" } });
  searchInput = input;
  const results = el("ul", { cls: "set-results", id: "set-results", attrs: { role: "listbox", "aria-label": "Найденные настройки" } });
  results.hidden = true;
  let hits: { id: SectionId; title: string; where: HTMLElement }[] = [];
  let cursor = 0;
  const index = () => {
    const out: { id: SectionId; title: string; text: string; where: HTMLElement }[] = [];
    for (const sec of SECTIONS) {
      const card = document.getElementById("set-" + sec.id);
      if (!card) continue;
      out.push({ id: sec.id, title: sec.title, text: `${sec.title} ${sec.keywords} ${card.querySelector(".set-card-head p")?.textContent ?? ""}`, where: card });
      for (const row of card.querySelectorAll<HTMLElement>(".set-card-body .set-row, .set-card-body .beh-field, .set-card-body [data-q]")) {
        const title = row.dataset.q ?? row.querySelector("strong")?.textContent ?? row.querySelector("span")?.textContent ?? "";
        if (title) out.push({ id: sec.id, title, text: `${title} ${row.textContent ?? ""} ${sec.title}`, where: row });
      }
    }
    return out;
  };
  const paint = () => {
    results.replaceChildren(...hits.map((h, i) => {
      const li = el("li", { cls: `tone-${sectionOf(h.id).tone}` + (i === cursor ? " on" : ""), id: "set-r-" + i, attrs: { role: "option", "aria-selected": String(i === cursor) } },
        icon(sectionOf(h.id).icon, 16), el("span", { cls: "grow", textContent: h.title }), el("small", { cls: "muted", textContent: h.where.id === "set-" + h.id ? "раздел" : sectionOf(h.id).title }));
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
      return li;
    }));
    if (!hits.length && input.value.trim()) results.append(el("li", { cls: "set-none muted", textContent: "Ничего не нашлось. Попробуйте другое слово." }));
    results.hidden = !input.value.trim();
    input.setAttribute("aria-expanded", String(!results.hidden));
    if (hits[cursor]) input.setAttribute("aria-activedescendant", "set-r-" + cursor); else input.removeAttribute("aria-activedescendant");
  };
  const pick = (i: number) => {
    const h = hits[i];
    if (!h) return;
    input.value = ""; hits = []; paint();
    jump(h.id, h.where === document.getElementById("set-" + h.id) ? undefined : h.where);
    h.where.classList.remove("set-hit"); void h.where.offsetWidth; h.where.classList.add("set-hit");
    setTimeout(() => h.where.classList.remove("set-hit"), 1800);
    const focusable = h.where.querySelector<HTMLElement>("input, textarea, button");
    focusable?.focus({ preventScroll: true });
  };
  input.addEventListener("input", () => {
    const q = input.value.trim();
    const seen = new Set<HTMLElement>();
    hits = q ? index().filter((x) => matches(q, x.text) && !seen.has(x.where) && seen.add(x.where)).slice(0, 8) : [];
    cursor = 0; paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); cursor = (cursor + 1) % hits.length; paint(); }
    else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); cursor = (cursor - 1 + hits.length) % hits.length; paint(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(cursor); }
    else if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; hits = []; paint(); }
  });
  input.addEventListener("blur", () => setTimeout(() => { results.hidden = true; input.setAttribute("aria-expanded", "false"); }, 120));
  input.addEventListener("focus", () => { if (input.value.trim()) paint(); });
  const search = el("div", { cls: "set-search" }, icon("search", 16), input, el("kbd", { cls: "kbd", textContent: "Ctrl ," }), results);

  // collapse / expand every card at once
  const all = el("button", { type: "button", cls: "set-all small" });
  syncCollapseAll = () => { const n = readPagePrefs().collapsed.length; all.textContent = n >= SECTIONS.length ? "Развернуть все" : "Свернуть все"; };
  syncCollapseAll();
  all.addEventListener("click", () => {
    const close = readPagePrefs().collapsed.length < SECTIONS.length;
    for (const sec of document.querySelectorAll<HTMLElement>(".set-card")) setCollapsed(sec, close);
  });

  mark("conn");
  stopSpy?.();
  stopSpy = null;
  setTimeout(() => {
    const scroller = nav.closest(".content");
    if (!scroller || !nav.isConnected) return;
    const spy = () => {
      if (!nav.isConnected) { stopSpy?.(); stopSpy = null; return; } // the page was left: stop listening
      if (Date.now() < pinned) return;
      const top = scroller.getBoundingClientRect().top + 160;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let cur: string = "conn";
      for (const sec of SECTIONS) { const s = document.getElementById("set-" + sec.id); if (s && s.getBoundingClientRect().top <= top) cur = sec.id; }
      mark(atEnd ? "about" : cur);
    };
    const unpin = () => { pinned = 0; };
    scroller.addEventListener("scroll", spy, { passive: true });
    for (const ev of ["wheel", "touchstart", "keydown"]) scroller.addEventListener(ev, unpin, { passive: true });
    spy();
    stopSpy = () => { scroller.removeEventListener("scroll", spy); for (const ev of ["wheel", "touchstart", "keydown"]) scroller.removeEventListener(ev, unpin); };
  });
  return el("aside", { cls: "set-side" }, search, nav, all);
}

// ---------------------------------------------------------------- assistant cards

const SUGGEST_MODES: ["off" | "rules" | "smart", string, string][] = [["off", "Выключено", "Ничего не предлагает."], ["rules", "По фразам", "После «Запомни…», «Я предпочитаю…», «Меня зовут…»."], ["smart", "Умно", "Ещё и модель сама замечает важные факты."]];

/** Cards for what the assistant may do. Everything here only ever NARROWS or tunes; memory entries still need your "Принять". */
function assistantCards(s: AppState): HTMLElement[] {
  const cfg = s.assistantSettings;
  if (!cfg) return (["model", "persona", "memory", "tools", "quick"] as const).map((id) => card(id, "Загружаю настройки помощницы…", {}, el("div", { cls: "set-skeleton" }, el("i"), el("i"))));
  const save = async (patch: SettingsPatch, ok = "Сохранено"): Promise<boolean> => {
    const r = await api.saveAssistantSettings(patch);
    showToast(r.ok ? ok : r.error.message, { ms: r.ok ? 3000 : 8000 });
    if (r.ok) app.set({ assistantSettings: r.value });
    return r.ok;
  };
  const reset = (title: string, what: string, patch: (d: AssistantSettings) => SettingsPatch, clear: string[] = []) => () => void withDefaults((d) => {
    if (!confirm(`Вернуть раздел «${title}» к исходным настройкам? ${what}`)) return;
    for (const k of clear) drafts.delete(k);
    void save(patch(d), `Раздел «${title}»: исходные настройки`);
  });

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
    { reset: reset("Модель", "Основная модель, запасная и размышления станут как при установке.", (d) => ({ chat: d.chat }), ["Основная модель", "Запасная модель"]) },
    el("div", { cls: "set-row stack" }, rowHead("spark", "Модели", "Запасная пробуется один раз, если основная не ответила."),
      el("div", { cls: "set-sub" }, el("div", { cls: "set-grid2" }, chatModel.wrap, fallback.wrap), options, el("div", { cls: "row" }, saveModels, reload), modelsNote)),
    itoggle("thought", "Размышления модели", "Модель сначала обдумывает ответ (пока видно «Обдумываю ответ»). Выключите, чтобы отвечала быстрее; работает не на всех моделях.", cfg.chat.reasoning,
      (v) => save({ chat: { model: cfg.chat.model, fallbackModel: cfg.chat.fallbackModel, reasoning: v } }, v ? "Размышления включены" : "Размышления выключены")));

  // ---- the owner's instructions, sent with every request
  const area = (name: IconName, label: string, value: string, placeholder: string) => {
    const draft = drafts.get(label);
    if (draft === value) drafts.delete(label);
    const t = el("textarea", { value: draft ?? value, placeholder, maxLength: MAX_INSTRUCTIONS, rows: 4, cls: "set-area", attrs: { "aria-label": label } });
    const count = el("small", { cls: "muted set-count", attrs: { "aria-live": "off" } });
    const sync = () => { count.textContent = `${t.value.length} / ${MAX_INSTRUCTIONS}`; if (t.value === value) drafts.delete(label); else drafts.set(label, t.value); };
    t.addEventListener("input", sync);
    sync();
    return { wrap: el("label", { cls: "beh-field" }, el("span", { cls: "set-flabel" }, ic(name), label), t, count), input: t };
  };
  const about = area("chat", "Что помощнице знать о вас", cfg.instructions.about, "Например: меня зовут Аня, я дизайнер интерфейсов в Москве. Пишу на TypeScript, учу японский.");
  const style = area("edit", "Как отвечать", cfg.instructions.style, "Например: коротко и по делу, без вступлений. Код с комментариями. Обращайся на «ты».");
  const saveInstr = dirtySave([about.input, style.input], [cfg.instructions.about, cfg.instructions.style], "Сохранить", () =>
    void save({ instructions: { about: about.input.value.trim(), style: style.input.value.trim() } }, about.input.value.trim() || style.input.value.trim() ? "Инструкции сохранены: помощница учтёт их со следующего ответа" : "Инструкции очищены"));
  const templates = el("div", { cls: "set-chips", attrs: { "data-q": "Шаблоны инструкций" } }, el("span", { cls: "set-flabel" }, ic("sparkle"), "Шаблоны:"), ...STYLE_TEMPLATES.map(([name, text]) => {
    const b = el("button", { type: "button", cls: "chip", textContent: name, title: text, attrs: { "aria-pressed": String(style.input.value.trim() === text) } });
    b.addEventListener("click", () => {
      const cur = style.input.value.trim();
      if (cur && cur !== text && !confirm(`Заменить текст «Как отвечать» шаблоном «${name}»?`)) return;
      style.input.value = text; style.input.dispatchEvent(new Event("input"));
      for (const x of templates.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
      style.input.focus();
    });
    return b;
  }));
  const previewText = el("pre", { cls: "set-prompt" });
  const syncPreview = () => { previewText.textContent = instructionsPreview(about.input.value, style.input.value) || "Пока пусто: помощница отвечает как обычно."; };
  for (const t of [about.input, style.input]) t.addEventListener("input", syncPreview);
  syncPreview();
  const preview = el("details", { cls: "set-details", attrs: { "data-q": "Что уходит помощнице" } }, el("summary", {}, ic("view"), "Что уходит помощнице с каждым сообщением"), previewText);
  const personaCard = card("persona", "Ваши пожелания уходят помощнице с каждым сообщением, поэтому не нужно повторять их в каждом чате. Действий они не разрешают.",
    { reset: cfg.instructions.about || cfg.instructions.style ? reset("Инструкции", "Оба поля станут пустыми.", () => ({ instructions: { about: "", style: "" } }), ["Что помощнице знать о вас", "Как отвечать"]) : undefined },
    about.wrap, style.wrap, templates, preview, el("div", { cls: "row" }, saveInstr));

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
    { reset: reset("Память", "Поиск по смыслу, модель эмбеддингов, предложения и сводки станут как при установке.", (d) => ({ embeddings: d.embeddings, suggestions: d.suggestions, summaries: d.summaries }), ["Модель эмбеддингов"]) },
    itoggle("search", "Поиск по смыслу", "Ищет не только по словам, но и по значению. При сбоях сам переключается на поиск по словам.", cfg.embeddings.enabled,
      (v) => save({ embeddings: { enabled: v, model: cfg.embeddings.model } }, v ? "Поиск по смыслу включён" : "Поиск по смыслу выключен")),
    embSub,
    el("div", { cls: "set-row stack" }, rowHead("pin", "Предлагать запомнить", "Предложения появляются в «Ждут решения»."), modes),
    itoggle("list", "Сводка длинных бесед", "Начало долгого разговора сжимается в краткое содержание, чтобы помощница не теряла нить.", cfg.summaries, (v) => save({ summaries: v }, v ? "Сводки включены" : "Сводки выключены")));

  // ---- tools: the internet and one folder
  const brave = cfg.webSearch.provider === "brave";
  const braveKey = el("input", { type: "password", autocomplete: "off", spellcheck: false, cls: "key-input mono", placeholder: cfg.webSearch.braveKeySet ? "Ключ сохранён. Вставьте новый, чтобы заменить" : "Ключ API Brave Search", attrs: { "aria-label": "Ключ Brave Search" } });
  const saveBrave = btn(cfg.webSearch.braveKeySet ? "Заменить ключ" : "Сохранить и включить", () => {
    const k = braveKey.value.trim();
    if (!k) { braveKey.focus(); return; }
    braveKey.value = "";
    void save({ webSearch: { provider: "brave", braveKey: k } } as SettingsPatch, "Поиск через Brave Search включён");
  }, { small: true, primary: true });
  braveKey.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveBrave.click(); } });
  const PROVIDERS: ["duckduckgo" | "brave", string, string][] = [["duckduckgo", "DuckDuckGo", "Без ключа и регистрации. При частых запросах может временно ограничивать."], ["brave", "Brave Search", "Стабильнее, нужен свой ключ API (есть бесплатный тариф)."]];
  const providers = el("div", { cls: "choice-cards two", attrs: { role: "radiogroup", "aria-label": "Поисковик" } }, ...PROVIDERS.map(([v, title, hint]) => {
    const b = el("button", { type: "button", cls: "choice-card", attrs: { role: "radio", "aria-checked": String(cfg.webSearch.provider === v) } }, el("strong", { textContent: title }), el("span", { cls: "muted", textContent: hint }));
    b.addEventListener("click", () => {
      if (cfg.webSearch.provider === v) return;
      if (v === "brave" && !cfg.webSearch.braveKeySet) { braveSub.hidden = false; braveKey.focus(); showToast("Вставьте ключ Brave Search и нажмите «Сохранить и включить»."); return; }
      void save({ webSearch: { provider: v } } as SettingsPatch, `Поиск: ${title}`);
    });
    return b;
  }));
  const braveSub = el("div", { cls: "set-inline" }, braveKey, saveBrave);
  braveSub.hidden = !brave && !cfg.webSearch.braveKeySet;
  const webSub = el("div", { cls: "set-sub" },
    el("div", { cls: "set-row stack" }, rowHead("search", "Поисковик", "Куда уходят поисковые запросы помощницы."), providers), braveSub,
    el("p", { cls: "muted small", textContent: "Помощница открывает только ссылки из результатов поиска и из ваших сообщений. Адреса этого компьютера и домашней сети закрыты." }));
  webSub.hidden = !cfg.web;
  const root = field({ label: "Папка", value: cfg.files.root, placeholder: "Например: C:\\Users\\Я\\Документы\\Заметки", mono: true });
  const saveRoot = dirtySave([root.input], [cfg.files.root], cfg.files.root ? "Сменить папку" : "Открыть доступ", () => void save({ files: { root: root.input.value.trim() } }, root.input.value.trim() ? (cfg.files.allowWrite ? "Папка выбрана. Запись для новой папки выключена" : "Папка выбрана") : "Доступ к файлам закрыт"));
  const access = cfg.files.root
    ? el("div", { cls: "set-badge ok" }, icon("folder", 16), el("span", { cls: "grow" }, "Открыт доступ к ", el("code", { textContent: cfg.files.root })),
      btn("Закрыть", () => void save({ files: { root: "", allowWrite: false } }, "Доступ к файлам закрыт"), { small: true }))
    : el("div", { cls: "set-badge" }, icon("shield", 16), el("span", { textContent: "Доступ к файлам закрыт. Укажите одну папку, чтобы помощница могла в ней читать и искать." }));
  const write = cfg.files.root ? itoggle("edit", "Разрешить запись в эту папку", "Создание и замена текстовых документов (.md, .txt, .csv…). Каждый раз нужно ваше подтверждение; прежняя версия сохраняется в резервной копии.", cfg.files.allowWrite,
    (v) => save({ files: { root: cfg.files.root, allowWrite: v } }, v ? "Запись разрешена" : "Запись запрещена")) : null;
  const toolsCard = card("tools", "Что помощница может открыть сама. Каждый инструмент можно выключить.",
    { reset: reset("Инструменты", "Интернет выключится, поиск вернётся на DuckDuckGo, доступ к папке закроется.", (d) => ({ web: d.web, webSearch: { provider: d.webSearch.provider }, files: { root: "", allowWrite: false } } as SettingsPatch), ["Папка"]) },
    itoggle("globe", "Доступ в интернет", "Ищет в интернете, читает страницы и Википедию, в ответе указывает ссылки на источники. Только чтение: ничего не отправляет и не публикует.", cfg.web, (v) => save({ web: v }, v ? "Доступ в интернет включён" : "Доступ в интернет выключен")),
    webSub,
    el("div", { cls: "set-row stack" }, rowHead("folder", "Доступ к файлам", "Только текстовые файлы до 200 КБ. Секреты (.env, ключи), .git, node_modules и ссылки наружу всегда закрыты."),
      el("div", { cls: "set-sub" }, access, el("div", { cls: "set-inline" }, root.wrap, saveRoot))),
    write);

  // ---- quick commands
  const NAME_RE = /^[\p{L}\p{N}_-]{1,24}$/u;
  let editing: string | null = null;
  const qName = field({ label: "Команда", value: "", placeholder: "итоги", maxLength: 25 });
  const qText = field({ label: "Что отправить", value: "", placeholder: "Подведи итоги дня {дата}", maxLength: 2000 });
  const qPrefix = el("span", { cls: "q-prefix", textContent: "/" });
  qName.input.before(qPrefix);
  qName.wrap.classList.add("q-name");
  qText.wrap.classList.add("grow");
  const qCancel = btn("Отмена", () => { editing = null; drafts.delete("Команда"); drafts.delete("Что отправить"); qName.input.value = ""; qText.input.value = ""; qAdd.lastChild!.textContent = "Добавить"; qCancel.hidden = true; }, { small: true });
  qCancel.hidden = true;
  const qAdd = btn("Добавить", async () => {
    const name = qName.input.value.trim().toLowerCase().replace(/^\//, ""), text = qText.input.value.trim();
    if (!name || !text) { showToast("Заполните имя команды и текст."); (name ? qText : qName).input.focus(); return; }
    if (!NAME_RE.test(name)) { showToast("Имя команды: до 24 букв, цифр, «-» или «_», без пробелов."); qName.input.focus(); return; }
    if (name !== editing && cfg.quickCommands.some((c) => c.name === name)) { showToast(`Команда /${name} уже есть.`); qName.input.focus(); return; }
    drafts.delete(qName.input.getAttribute("aria-label") ?? ""); drafts.delete(qText.input.getAttribute("aria-label") ?? "");
    const list = editing ? cfg.quickCommands.map((c) => (c.name === editing ? { name, text } : c)) : [...cfg.quickCommands, { name, text }];
    if (await save({ quickCommands: list }, editing ? `Команда /${name} изменена` : `Команда /${name} добавлена`)) { editing = null; qName.input.value = ""; qText.input.value = ""; }
  }, { small: true, primary: true, icon: "plus" });
  for (const f of [qName.input, qText.input]) f.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); qAdd.click(); } });
  const reorder = (from: number, to: number) => { if (from !== to) void save({ quickCommands: move(cfg.quickCommands, from, to) }, "Порядок команд сохранён"); };
  let dragFrom = -1;
  const quickList = cfg.quickCommands.length
    ? el("ul", { cls: "beh-quick" }, ...cfg.quickCommands.map((c, i) => {
      const grip = el("button", { type: "button", cls: "icon-btn sm q-grip", title: "Перетащите, чтобы изменить порядок (или ↑ ↓)", attrs: { "aria-label": `Переместить /${c.name}: стрелки вверх и вниз` } }, icon("grip", 16));
      grip.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); reorder(i, i - 1); }
        else if (e.key === "ArrowDown" && i < cfg.quickCommands.length - 1) { e.preventDefault(); reorder(i, i + 1); }
      });
      const li = el("li", { draggable: true }, grip, el("code", { textContent: "/" + c.name }), el("span", { cls: "grow muted", textContent: c.text, title: c.text }),
        iconButton("edit", "Изменить /" + c.name, () => { editing = c.name; qName.input.value = c.name; qText.input.value = c.text; qAdd.lastChild!.textContent = "Сохранить"; qCancel.hidden = false; qText.input.focus(); }, "icon-btn sm"),
        iconButton("trash", "Удалить /" + c.name, () => void save({ quickCommands: cfg.quickCommands.filter((x) => x.name !== c.name) }, `Команда /${c.name} удалена`), "icon-btn sm"));
      li.addEventListener("dragstart", (e) => { dragFrom = i; li.classList.add("dragging"); e.dataTransfer?.setData("text/plain", c.name); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
      li.addEventListener("dragend", () => { li.classList.remove("dragging"); for (const x of li.parentElement?.children ?? []) x.classList.remove("drop-before", "drop-after"); });
      li.addEventListener("dragover", (e) => { if (dragFrom < 0) return; e.preventDefault(); li.classList.toggle("drop-before", dragFrom > i); li.classList.toggle("drop-after", dragFrom < i); });
      li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
      li.addEventListener("drop", (e) => { e.preventDefault(); const from = dragFrom; dragFrom = -1; reorder(from, i); });
      return li;
    }))
    : el("p", { cls: "set-empty muted small", textContent: "Команд пока нет. Например, «/итоги» может отправлять «Подведи итоги дня {дата}»." });
  const placeholders = el("div", { cls: "set-chips", attrs: { "data-q": "Подстановки в командах" } }, el("span", { cls: "set-flabel" }, ic("sparkle"), "Подстановки:"), ...PLACEHOLDERS.map(([word, hint]) => {
    const b = el("button", { type: "button", cls: "chip mono", textContent: word, title: `Заменится на: ${hint}` });
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret in the text field
    b.addEventListener("click", () => {
      const t = qText.input, at = t.selectionStart ?? t.value.length, end = t.selectionEnd ?? at;
      t.setRangeText(word, at, end, "end"); t.dispatchEvent(new Event("input")); t.focus();
    });
    return b;
  }));
  const quickCard = card("quick", "Короткое «/имя» в чате отправляет заготовленный текст. Порядок меняется перетаскиванием.",
    { reset: cfg.quickCommands.length ? () => { if (confirm(`Удалить все быстрые команды (${cfg.quickCommands.length})?`)) { const before = cfg.quickCommands; void save({ quickCommands: [] }, "Быстрые команды удалены").then((ok) => { if (ok) showToast("Быстрые команды удалены", { action: { label: "Отменить", run: () => void save({ quickCommands: before }, "Команды возвращены") }, ms: 10000 }); }); } } : undefined },
    quickList, el("div", { cls: "beh-add" }, qName.wrap, qText.wrap, el("div", { cls: "row" }, qAdd, qCancel)), placeholders);

  return [modelCard, personaCard, memoryCard, toolsCard, quickCard];
}

// ---------------------------------------------------------------- «Проверить всё»

const CHECK_ICON: Record<CheckResult["id"], IconName> = { key: "key", model: "spark", fallback: "refresh", embeddings: "search", web: "globe" };
function checksView(): HTMLElement {
  const list = el("ul", { cls: "set-checks", attrs: { "aria-live": "polite" } });
  const paint = () => {
    list.replaceChildren(...checks.map((c) => el("li", { cls: c.status },
      el("span", { cls: "set-ic" }, icon(CHECK_ICON[c.id], 16)),
      el("span", { cls: "grow" }, el("strong", { textContent: c.title }), el("small", { cls: "muted", textContent: c.detail })),
      c.ms !== undefined && c.status !== "skip" ? el("code", { textContent: c.ms < 1000 ? `${c.ms} мс` : `${(c.ms / 1000).toFixed(1)} с` }) : null,
      el("span", { cls: "set-cstat", textContent: c.status === "ok" ? "работает" : c.status === "fail" ? "ошибка" : "пропущено" }))));
    list.hidden = !checks.length;
  };
  paint();
  const run = btn(checking ? "Проверяю…" : "Проверить всё", async () => {
    checking = true; run.disabled = true; run.lastChild!.textContent = "Проверяю…";
    const r = await api.selfTest();
    checking = false;
    if (!r.ok) showToast(r.error.message);
    else {
      checks = r.value.checks;
      const bad = checks.filter((c) => c.status === "fail").length;
      showToast(bad ? `Проверка: проблем ${bad}. Подробности в разделе «Подключение».` : "Проверка: всё работает", { ms: 4000 });
    }
    if (run.isConnected) { run.disabled = false; run.lastChild!.textContent = "Проверить всё"; paint(); }
    paintHealth?.();
  }, { small: true, icon: "pulse", disabled: checking, title: "Проверить ключ, модели, поиск по смыслу и интернет" });
  return el("div", { cls: "set-row stack", attrs: { "data-q": "Проверить всё: ключ, модели, эмбеддинги, интернет" } },
    el("div", { cls: "set-rowline" }, rowHead("pulse", "Проверка соединения", "Ключ, основная и запасная модель, поиск по смыслу и интернет: что работает и как быстро."), run), list);
}

// ---------------------------------------------------------------- the page

export function settingsPage(s: AppState, chats: Chats): HTMLElement {
  const ok = !!s.status?.assistant;
  const model = s.assistantSettings?.chat.model || s.status?.model || "";
  const flash = sessionStorage.getItem(FLASH_KEY);
  if (flash) { sessionStorage.removeItem(FLASH_KEY); setTimeout(() => showToast(flash, { ms: 10000 }), 300); }

  // ---- assistant connection
  const note = el("p", { cls: "flash" + (KEY_FLASH.bad ? " bad" : ""), attrs: { role: "status" }, textContent: KEY_FLASH.text });
  const key = el("input", { type: "password", name: "key", id: "cloud-key", autocomplete: "new-password", placeholder: ok ? "Вставьте новый ключ, чтобы заменить" : "Вставьте API-ключ Cloud.ru", required: true, spellcheck: false, cls: "key-input", attrs: { "aria-label": "API-ключ Cloud.ru" } });
  const eye = el("button", { type: "button", cls: "icon-btn", title: "Показать ключ", attrs: { "aria-label": "Показать ключ", "aria-pressed": "false" } }, icon("eye", 18));
  eye.addEventListener("click", () => { const show = key.type === "password"; key.type = show ? "text" : "password"; eye.title = show ? "Скрыть ключ" : "Показать ключ"; eye.setAttribute("aria-pressed", String(show)); });
  const save = btn(ok ? "Заменить ключ" : "Сохранить и подключить", () => {}, { primary: true });
  save.type = "submit";
  save.disabled = true;
  key.addEventListener("input", () => { save.disabled = !key.value.trim(); });
  const form = el("form", { cls: "key-form", attrs: { "data-q": "API-ключ Cloud.ru" } }, el("div", { cls: "key-field" }, ic("key"), key, eye), save);
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
  const conn = card("conn", "Ключ Cloud.ru хранится только на этом компьютере (data/cloudru-settings.json), не в браузере и не в GitHub.", {},
    status, form, note, checksView());

  // ---- appearance
  const setLook = (patch: Partial<AppState>) => { app.set(patch); persistPrefs(app.get()); };
  const custom = el("input", { type: "color", value: isHexColor(s.customAccent) ? s.customAccent : "#e0662f", attrs: { "aria-label": "Свой цвет" } });
  const customPick = el("label", { cls: "swatch-pick custom", attrs: { role: "radio", "aria-checked": String(s.accent === "custom"), title: "Выбрать свой цвет" } },
    el("i", { cls: "swatch" }), el("span", { textContent: "Свой" }), custom);
  (customPick.firstChild as HTMLElement).style.background = s.customAccent;
  custom.addEventListener("input", () => { (customPick.firstChild as HTMLElement).style.background = custom.value; document.documentElement.style.setProperty("--brand", custom.value); document.documentElement.style.setProperty("--brand-fg", fgFor(custom.value)); });
  custom.addEventListener("change", () => setLook({ accent: "custom", customAccent: custom.value }));
  customPick.addEventListener("click", (e) => { if (e.target !== custom && s.accent !== "custom") { e.preventDefault(); setLook({ accent: "custom" }); } });
  const accents = el("div", { cls: "set-row stack" }, rowHead("palette", "Акцентный цвет", "Цвет кнопок, отметок и аватара. «Свой» открывает палитру."),
    el("div", { cls: "swatches", attrs: { role: "radiogroup", "aria-label": "Акцентный цвет" } }, ...ACCENTS.map((a) => {
      const b = el("button", { type: "button", cls: "swatch-pick", attrs: { role: "radio", "aria-checked": String(s.accent === a.id), "aria-label": a.label } }, el("i", { cls: "swatch" }), el("span", { textContent: a.label }));
      (b.firstChild as HTMLElement).style.background = swatchColor(a);
      b.addEventListener("click", () => setLook({ accent: a.id }));
      return b;
    }), customPick));
  const lookChanged = s.theme !== "auto" || s.accent !== "gold" || s.uiRadius !== "normal" || s.uiScale !== "md";
  const look = card("look", "Тема, цвет, скругления и размер интерфейса. Меняются сразу, хранятся в этом браузере.",
    { reset: lookChanged ? () => { if (confirm("Вернуть тему, цвет, скругления и размер к исходным?")) setLook({ theme: "auto", accent: "gold", uiRadius: "normal", uiScale: "md" }); } : undefined },
    el("div", { cls: "set-row stack", attrs: { "data-q": "Тема" } }, rowHead("auto", "Тема", "Светлая, тёмная или как в системе."), themeCards(s)), accents,
    segmented<UiRadius>("corner", "Скругление", "Углы карточек и кнопок", [["sharp", "Острые"], ["normal", "Обычные"], ["round", "Круглые"]], s.uiRadius, (v) => app.set({ uiRadius: v })),
    segmented<UiScale>("zoom", "Масштаб", "Размер текста и элементов всего приложения", [["sm", "Мельче"], ["md", "Обычный"], ["lg", "Крупнее"]], s.uiScale, (v) => app.set({ uiScale: v })));

  // ---- chat, with a live preview of density, text size and scenes
  const preview = el("div", { cls: ["chat-preview", s.chatDensity === "compact" ? "dens-compact" : "", s.chatFont !== "md" ? "font-" + s.chatFont : ""].filter(Boolean).join(" "), attrs: { "aria-hidden": "true" } },
    el("div", { cls: "cp-user" }, el("span", { textContent: "Что у меня на завтра?" })),
    s.showScenes ? el("div", { cls: "cp-scene", textContent: "Листает блокнот. «Сейчас посмотрю.»" }) : null,
    el("div", { cls: "cp-bot", textContent: "Завтра в 10:00 созвон с командой, а вечером вы хотели позвонить маме." }));
  const chatChanged = s.chatDensity !== "comfortable" || s.chatFont !== "md" || !s.showScenes;
  const chat = card("chat", "Как выглядят сообщения в окне чата.",
    { reset: chatChanged ? () => setLook({ chatDensity: "comfortable", chatFont: "md", showScenes: true }) : undefined },
    el("div", { cls: "set-split" },
      el("div", { cls: "grow" },
        segmented("rows", "Плотность", "Расстояние между сообщениями", [["comfortable", "Свободно"], ["compact", "Компактно"]], s.chatDensity, (v) => app.set({ chatDensity: v })),
        segmented("textSize", "Размер текста", "Только в окне чата", [["sm", "Мелкий"], ["md", "Обычный"], ["lg", "Крупный"]], s.chatFont, (v) => app.set({ chatFont: v })),
        switchRow("scenes", "Сцены персонажа", "Описание действия и реплика над ответами", s.showScenes, (v) => app.set({ showScenes: v }))),
      el("figure", { cls: "set-preview" }, el("figcaption", { cls: "muted small", textContent: "Так будет в чате" }), preview)));

  // ---- data
  const items = chats.store.get().items;
  const msgs = items.reduce((n, c) => n + c.messages.length, 0);
  const bytes = new Blob([JSON.stringify(items)]).size;
  const prefs = readPagePrefs();
  const stat = (n: string, t: string) => el("div", { cls: "set-stat" }, el("strong", { textContent: n }), el("span", { cls: "muted", textContent: t }));
  const download = (data: unknown, name: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const backupBtn = btn("Скачать копию", async () => {
    backupBtn.disabled = true;
    const mem = await api.memoryExport();
    const local: Record<string, string | null> = {};
    for (const k of BACKUP_PREFS) local[k] = localStorage.getItem(k);
    download(makeBackup({ chats: chats.store.get().items, settings: app.get().assistantSettings, memory: mem.ok ? mem.value : null, prefs: local, now: new Date() }), `juunibi-backup-${today()}.json`);
    writePagePrefs({ lastBackup: Date.now() });
    backupBtn.disabled = false;
    showToast(mem.ok ? "Резервная копия сохранена: чаты, настройки, инструкции, команды и память" : "Копия сохранена без памяти: " + mem.error.message, { ms: 5000 });
    lastLine.textContent = "Последняя копия: только что";
    paintHealth?.();
  }, { primary: true, small: true, icon: "download" });
  const restoreFile = el("input", { type: "file", accept: "application/json,.json", hidden: true });
  restoreFile.addEventListener("change", async () => {
    const f = restoreFile.files?.[0]; restoreFile.value = "";
    if (!f) return;
    let raw: unknown;
    try { raw = JSON.parse(await f.text()); } catch { showToast("Не удалось прочитать файл: это не JSON."); return; }
    const p = parseBackup(raw);
    if (!p.ok) { showToast(p.error); return; }
    const b = p.backup;
    const when = b.createdAt ? ` от ${new Date(b.createdAt).toLocaleString("ru-RU")}` : "";
    const parts = [`чаты (${b.chats.length}) добавятся к текущим`, b.settings ? "настройки, инструкции и быстрые команды заменятся" : "", b.memory ? "записи памяти добавятся" : "", Object.keys(b.prefs).length ? "внешний вид и меню станут как в копии" : ""].filter(Boolean);
    if (!confirm(`Восстановить из копии${when}?\n\n${parts.join(";\n")}.\n\nПапка для файлов и ключи не переносятся.`)) return;
    const report: string[] = [];
    const { added, dropped } = chats.importJson(b.chats);
    report.push(`чатов добавлено: ${added}` + (dropped ? `, не поместилось: ${dropped}` : ""));
    if (b.settings) { const r = await api.saveAssistantSettings(b.settings); report.push(r.ok ? "настройки восстановлены" : "настройки не восстановлены: " + r.error.message); }
    if (b.memory) { const r = await api.memoryImport(b.memory); report.push(r.ok ? `записей памяти добавлено: ${r.value.added}` : "память не восстановлена: " + r.error.message); }
    for (const [k, v] of Object.entries(b.prefs)) { try { localStorage.setItem(k, v); } catch { /* storage full or blocked: the rest still applies */ } }
    chats.persistNow();
    sessionStorage.setItem(FLASH_KEY, "Восстановлено из копии: " + report.join("; ") + ".");
    location.reload();
  });
  const restoreBtn = btn("Восстановить", () => restoreFile.click(), { small: true, icon: "undo", title: "Восстановить из файла резервной копии" });
  const lastLine = el("small", { cls: "muted", textContent: prefs.lastBackup ? "Последняя копия: " + new Date(prefs.lastBackup).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "Копию ещё не делали" });
  const backup = el("div", { cls: "set-row stack", attrs: { "data-q": "Резервная копия всего" } },
    rowHead("archive", "Резервная копия всего", "Один файл: чаты, настройки, инструкции, быстрые команды, память, внешний вид и меню. Восстанавливается одной кнопкой."),
    el("div", { cls: "set-sub" }, el("div", { cls: "row" }, backupBtn, restoreBtn, restoreFile, el("span", { cls: "grow" }), lastLine)));

  const wipe = btn("Удалить все чаты", () => {
    if (!confirm("Удалить всю историю чатов в этом браузере?")) return;
    const before = chats.store.get().items;
    chats.clearAll();
    showToast(`Удалено чатов: ${before.length}`, { action: { label: "Отменить", run: () => chats.restore(before) }, ms: 10000 });
  }, { danger: true, small: true, icon: "trash", disabled: !items.length });
  const exp = btn("Экспорт чатов", () => download(chats.store.get().items, `juunibi-chats-${today()}.json`), { small: true, icon: "download", disabled: !items.length, title: "Сохранить только чаты в файл JSON" });
  const file = el("input", { type: "file", accept: "application/json,.json", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files?.[0]; file.value = "";
    if (!f) return;
    let raw: unknown;
    try { raw = JSON.parse(await f.text()); } catch { showToast("Это не файл экспорта JUUNIBI: не удалось прочитать JSON."); return; }
    const p = parseBackup(raw);
    const { added, dropped } = chats.importJson(p.ok ? p.backup.chats : (raw as { items?: unknown })?.items);
    const full = dropped ? `Не поместилось: ${dropped} (здесь не больше 100 чатов, удалите ненужные и повторите импорт).` : "";
    showToast(added ? `Добавлено чатов: ${added}. ${full}`.trim() : full || "Новых чатов в файле нет: все уже здесь или файл пуст.", { ms: dropped ? 10000 : 4000 });
  });
  const imp = btn("Импорт чатов", () => file.click(), { small: true, icon: "paperclip", title: "Добавить чаты из ранее сохранённого файла" });
  const data = card("data", "История чатов хранится только в этом браузере. Резервная копия помогает перенести всё на другой компьютер или не потерять.", {},
    el("div", { cls: "set-stats" }, stat(String(items.length), "чатов"), stat(String(msgs), "сообщений"), stat(formatBytes(bytes), "занимает")),
    backup,
    el("div", { cls: "set-row stack", attrs: { "data-q": "Чаты: экспорт, импорт, удаление" } }, rowHead("chat", "Только чаты", "Файл с историей бесед, без настроек."),
      el("div", { cls: "row" }, exp, imp, file, el("span", { cls: "grow" }), wipe)));

  // ---- about
  const link = el("a", { href: "https://github.com/Aspksa/JUUNIBI", target: "_blank", rel: "noopener noreferrer", textContent: "github.com/Aspksa/JUUNIBI" });
  const version = short(s.update?.localVersion);
  const copy = iconButton("copy", "Скопировать версию", () => { void navigator.clipboard?.writeText(s.update?.localVersion ?? version).then(() => showToast("Версия скопирована", { ms: 2000 })); }, "icon-btn sm");
  const about = card("about", "Версия, исходный код и горячие клавиши.", {},
    el("div", { cls: "about-grid" },
      el("span", { cls: "set-flabel muted" }, ic("update"), "Версия"), el("span", { cls: "row" }, el("code", { textContent: version }), copy, el("a", { href: "#/update", cls: "small", textContent: "Проверить обновления" })),
      el("span", { cls: "set-flabel muted" }, ic("link"), "Исходный код"), link),
    el("div", { cls: "set-row stack", attrs: { "data-q": "Горячие клавиши" } },
      el("div", { cls: "set-rowline" }, rowHead("keyboard", "Горячие клавиши", "Нажмите «?» в любом месте приложения, чтобы открыть эту таблицу."), btn("Открыть", openHotkeys, { small: true })),
      hotkeyTable()));

  const pill = el("a", { href: "#/settings", cls: `set-pill ${ok ? "ok" : "off"}` }, dot(ok ? "ok" : "off"), ok ? "Подключена" : "Не подключена");
  pill.addEventListener("click", (e) => { e.preventDefault(); document.getElementById("set-conn")?.scrollIntoView({ behavior: "smooth", block: "start" }); if (!ok) key.focus({ preventScroll: true }); });

  const health = () => sectionHealth({ status: s.status, cfg: s.assistantSettings, checks, chats: chats.store.get().items.length, lastBackup: readPagePrefs().lastBackup, now: Date.now() });
  return el("div", { cls: "page settings-page" }, pageHead("settings", "Настройки", "Подключение помощницы, внешний вид и ваши данные.", pill),
    el("div", { cls: "set-layout" }, side(health), el("div", { cls: "set-main" }, conn, ...assistantCards(s), look, chat, data, about)));
}
