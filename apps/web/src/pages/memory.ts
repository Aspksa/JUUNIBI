import { api } from "../api";
import { el, iconButton } from "../dom";
import { refreshMemory, type AppState } from "../state";

export function memoryPage(s: AppState): HTMLElement {
  const items = [...s.memory].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
  const row = (m: AppState["memory"][number]) => {
    const li = el("li", { cls: "list-row" }, el("span", { cls: "grow", textContent: m.text }), m.status === "pending" ? el("span", { cls: "tag", textContent: "ждёт подтверждения" }) : null);
    if (m.status === "pending") {
      const ok = el("button", { type: "button", cls: "btn primary", textContent: "Принять" });
      ok.addEventListener("click", () => void api.approve(m.id).then(refreshMemory));
      li.append(ok);
    }
    li.append(iconButton("trash", `Забыть: ${m.text}`, () => void api.forget(m.id).then(refreshMemory), "icon-btn sm"));
    return li;
  };
  return el("div", { cls: "page" }, el("h1", { textContent: "Память" }),
    el("p", { cls: "muted lead", textContent: "Всё, что помощник запомнил. Новые уроки попадают сюда на подтверждение и работают только после вашего «Принять»." }),
    el("ul", { cls: "list" }, ...(items.length ? items.map(row) : [el("li", { cls: "empty-row", textContent: "Память пуста." })])));
}
