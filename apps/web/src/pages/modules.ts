import { el } from "../dom";
import type { AppState } from "../state";

export function modulesPage(s: AppState): HTMLElement {
  return el("div", { cls: "page" }, el("h1", { textContent: "Модули" }),
    el("p", { cls: "muted lead", textContent: "Модули ядра JUUNIBI и их состояние. Помощник видит этот же список." }),
    el("ul", { cls: "list" }, ...(s.modules.length
      ? s.modules.map((m) => el("li", { cls: "list-row" }, el("span", { cls: "grow", textContent: m.name }), el("span", { cls: "muted", textContent: m.deps.length ? "← " + m.deps.join(", ") : "" }), el("span", { cls: "tag " + m.status, textContent: m.status })))
      : [el("li", { cls: "empty-row", textContent: "Нет данных." })])));
}
