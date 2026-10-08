import { el } from "../dom";
import { api } from "../api";
import { pageHead, section } from "./kit";

/** Read-only dashboard: tasks are managed in the assistant chat, not through redundant buttons. */
export function brainPage(): HTMLElement {
  const root = el("div", { cls: "page" },
    pageHead("modules", "Мозг JUUNIBI", "Автоматические безопасные шаги через помощницу. Опасные действия требуют подтверждения."));
  const content = el("div", { attrs: { "aria-live": "polite" } }, el("p", { cls: "muted", textContent: "Загрузка состояния…" }));
  root.append(content);
  void api.brainStatus().then(r => {
    if (!r.ok) { content.replaceChildren(el("p", { textContent: "Не удалось загрузить мозг: " + r.error.message })); return; }
    const s = r.value;
    const info = section("Состояние",
      el("p", { textContent: s.assistantReady ? "ИИ подключён" : "ИИ не настроен" }),
      el("p", { cls: "muted", textContent: "Текущий режим: " + s.mode }));
    const plans = section("Планы",
      ...(s.plans.length ? s.plans.map(p => el("div", { cls: "pg-card" },
        el("strong", { textContent: p.goal }),
        el("p", { cls: "muted", textContent: "Статус: " + p.status }),
        el("ol", {}, ...p.steps.map(step => el("li", { textContent: step.title + " — " + step.status }))))) :
        [el("p", { cls: "muted", textContent: "Пока нет планов. Попросите JUUNIBI составить план прямо в чате." })]));
    content.replaceChildren(info, plans);
  });
  return root;
}
