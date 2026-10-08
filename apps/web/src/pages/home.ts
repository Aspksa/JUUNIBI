import { el, icon, short, type IconName } from "../dom";
import type { AppState, Route } from "../state";

export interface HomeDeps { go(r: Route): void; openChat(): void }

export function homePage(s: AppState, d: HomeDeps): HTMLElement {
  const ok = !!s.status?.assistant;
  const pending = s.memory.filter((m) => m.status === "pending").length;
  const u = s.update;
  const hasUpdate = !!(u?.latest && u.localVersion !== "не определена" && u.localVersion !== u.latest.sha);
  const card = (ic: IconName, title: string, value: string, hint: string, action: string, run: () => void, tone = "") => {
    const b = el("button", { type: "button", cls: "btn", textContent: action });
    b.addEventListener("click", run);
    return el("section", { cls: "stat " + tone }, el("div", { cls: "stat-head" }, icon(ic, 18), el("h2", { textContent: title })), el("p", { cls: "stat-value", textContent: value }), el("p", { cls: "muted", textContent: hint }), b);
  };
  return el("div", { cls: "page" },
    el("h1", { textContent: "Главная" }),
    el("p", { cls: "muted lead", textContent: "Нажмите на аватар в углу экрана, чтобы открыть чат. Аватар можно перетащить в любое место." }),
    el("div", { cls: "grid" },
      card("chat", "Помощник", ok ? "Подключён" : s.status ? "Нужен ключ" : "Проверка…", ok ? (s.status?.model ?? "") : "Добавьте ключ Cloud.ru в настройках.", ok ? "Открыть чат" : "Открыть настройки", ok ? d.openChat : () => d.go("settings"), ok ? "good" : "warn"),
      card("update", "Обновления", hasUpdate ? "Доступно" : "Актуально", `Версия: ${short(u?.localVersion)}${hasUpdate ? ` → ${u?.latest?.version}` : ""}`, "Открыть", () => d.go("update"), hasUpdate ? "warn" : ""),
      card("memory", "Память", pending ? `${pending} на подтверждении` : `${s.memory.length} записей`, "Новые уроки помощник предлагает сам — вы решаете, что запомнить.", "Открыть", () => d.go("memory"), pending ? "warn" : ""),
      card("modules", "Модули", s.modules.length ? String(s.modules.length) : "—", s.modules.length ? s.modules.map((m) => m.name).join(", ") : "Модули пока не зарегистрированы.", "Открыть", () => d.go("modules"))));
}
