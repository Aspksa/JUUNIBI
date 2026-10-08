import { api } from "../api";
import { el } from "../dom";
import { app, persistPrefs, refreshStatus, type AppState, type Theme } from "../state";
import type { Chats } from "../chat/chats";

export function settingsPage(s: AppState, chats: Chats): HTMLElement {
  // --- Cloud.ru
  const note = el("p", { cls: "muted", attrs: { role: "status" }, textContent: s.status?.assistant ? "Модель подключена." : "Ключ ещё не настроен." });
  const key = el("input", { type: "password", name: "key", id: "cloud-key", autocomplete: "new-password", placeholder: "Вставьте API-ключ Cloud.ru", required: true, spellcheck: false });
  const save = el("button", { type: "submit", cls: "btn primary", textContent: "Сохранить и подключить" });
  const form = el("form", { cls: "form" }, el("label", { htmlFor: "cloud-key", textContent: "API-ключ" }), key, save);
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); save.disabled = true;
    const r = await api.cloudSave(key.value.trim());
    key.value = ""; save.disabled = false;
    note.textContent = r.ok ? "Ключ сохранён локально. Помощник подключён." : r.error.message;
    if (r.ok) await refreshStatus();
  });

  // --- appearance
  const themes: [Theme, string][] = [["auto", "Как в системе"], ["light", "Светлая"], ["dark", "Тёмная"]];
  const themeRow = el("div", { cls: "segmented", attrs: { role: "radiogroup", "aria-label": "Тема" } }, ...themes.map(([v, label]) => {
    const b = el("button", { type: "button", textContent: label, attrs: { role: "radio", "aria-checked": String(s.theme === v) } });
    b.addEventListener("click", () => { app.set({ theme: v }); persistPrefs(app.get()); });
    return b;
  }));
  const scenes = el("input", { type: "checkbox", id: "scenes", checked: s.showScenes });
  scenes.addEventListener("change", () => { app.set({ showScenes: scenes.checked }); persistPrefs(app.get()); });

  // --- data
  const wipe = el("button", { type: "button", cls: "btn danger", textContent: "Удалить все чаты" });
  wipe.addEventListener("click", () => { if (confirm("Удалить всю историю чатов в этом браузере? Это нельзя отменить.")) { chats.clearAll(); wipe.textContent = "Удалено"; } });
  const exp = el("button", { type: "button", cls: "btn", textContent: "Экспорт чатов (JSON)" });
  exp.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(chats.store.get().items, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "juunibi-chats.json" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const section = (title: string, ...kids: (Node | string)[]) => el("section", { cls: "panel" }, el("h2", { textContent: title }), ...kids);
  return el("div", { cls: "page" }, el("h1", { textContent: "Настройки" }),
    section("Подключение Cloud.ru", el("p", { cls: "muted", textContent: "Ключ хранится только на локальном сервере (data/cloudru-settings.json), не в браузере и не в GitHub." }), form, note),
    section("Внешний вид", themeRow, el("label", { cls: "check", htmlFor: "scenes" }, scenes, el("span", { textContent: "Показывать сцены и реплики персонажа над ответами" }))),
    section("Данные", el("p", { cls: "muted", textContent: "История чатов хранится только в этом браузере." }), el("div", { cls: "row" }, exp, wipe)));
}
