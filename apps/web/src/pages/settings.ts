import { ACCENTS, swatchColor } from "../accents";
import { api } from "../api";
import type { Chats } from "../chat/chats";
import { formatBytes } from "../chat/helpers";
import { el, icon, short } from "../dom";
import { app, persistPrefs, refreshStatus, type AppState, type Theme } from "../state";
import { btn, dot, pageHead, section } from "./kit";

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

  return el("div", { cls: "page" }, pageHead("settings", "Настройки", "Подключение помощницы, внешний вид и ваши данные."), assistant, look, chat, data, about);
}
