import { api } from "../api";
import { el } from "../dom";
import { app, persistPrefs, refreshStatus, type AppState, type Theme } from "../state";
import type { Chats } from "../chat/chats";
import { button, field, input, panel, segmented, switchField } from "../ui";

export function settingsPage(s: AppState, chats: Chats): HTMLElement {
  // --- Cloud.ru
  const note = el("p", { cls: "muted", attrs: { role: "status" }, textContent: s.status?.assistant ? "Помощник подключён." : "Ключ ещё не настроен." });
  const key = input({ type: "password", placeholder: "Вставьте API-ключ Cloud.ru", autocomplete: "new-password", required: true, name: "key" });
  const save = button({ label: "Сохранить и подключить", variant: "primary", type: "submit" });
  const form = el("form", { cls: "form" }, field({ id: "cloud-key", label: "API-ключ", control: key }), save);
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); save.disabled = true;
    const r = await api.cloudSave(key.value.trim());
    key.value = ""; save.disabled = false;
    note.textContent = r.ok ? "Ключ сохранён локально. Помощник подключён." : r.error.message;
    if (r.ok) await refreshStatus();
  });

  // --- appearance
  const themes: readonly (readonly [Theme, string])[] = [["auto", "Как в системе"], ["light", "Светлая"], ["dark", "Тёмная"]];
  const themeRow = segmented<Theme>({ label: "Тема", options: themes, value: s.theme, onChange: (v) => { app.set({ theme: v }); persistPrefs(app.get()); } });
  const scenes = switchField({ id: "scenes", label: "Показывать сцены и реплики персонажа над ответами", checked: s.showScenes, onChange: (v) => { app.set({ showScenes: v }); persistPrefs(app.get()); } });

  // --- data
  const wipe = button({ label: "Удалить все чаты", variant: "danger", onClick: () => { if (confirm("Удалить всю историю чатов в этом браузере? Это нельзя отменить.")) { chats.clearAll(); wipe.textContent = "Удалено"; } } });
  const exp = button({ label: "Экспорт чатов (JSON)", onClick: () => {
    const blob = new Blob([JSON.stringify(chats.store.get().items, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "juunibi-chats.json" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } });

  return el("div", { cls: "page" }, el("h1", { textContent: "Настройки" }),
    panel("Подключение Cloud.ru", el("p", { cls: "muted", textContent: "Ключ хранится только на локальном сервере (data/cloudru-settings.json), не в браузере и не в GitHub." }), form, note),
    panel("Внешний вид", el("div", { cls: "stack" }, themeRow, scenes)),
    panel("Данные", el("p", { cls: "muted", textContent: "История чатов хранится только в этом браузере." }), el("div", { cls: "row" }, exp, wipe)));
}
