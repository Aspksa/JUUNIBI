import { el, icon } from "../dom";
import type { AppState, Route } from "../state";
import { buildModules, type ModView } from "./models";
import { btn, dot, emptyState, pageHead } from "./kit";

const STATUS_TEXT: Record<ModView["status"], string> = { started: "Работает", pending: "Ждёт настройки", failed: "Сбой" };
const TONE: Record<ModView["status"], "ok" | "warn" | "bad"> = { started: "ok", pending: "warn", failed: "bad" };

export function modulesPage(s: AppState, go: (r: Route) => void): HTMLElement {
  const { items, counts } = buildModules(s.modules);
  const summary = el("div", { cls: "mod-summary" },
    el("span", { cls: "mod-count ok" }, dot("ok"), `${counts.started} работают`),
    counts.pending ? el("span", { cls: "mod-count warn" }, dot("warn"), `${counts.pending} ждут настройки`) : null,
    counts.failed ? el("span", { cls: "mod-count bad" }, dot("bad"), `${counts.failed} со сбоем`) : null);

  const card = (m: ModView) => {
    const action = m.name === "assistant" && m.status === "pending" ? btn("Настроить", () => go("settings"), { small: true, primary: true })
      : m.name === "updater" ? btn("Открыть", () => go("update"), { small: true })
      : m.name === "memory" ? btn("Открыть", () => go("memory"), { small: true })
      : m.name === "brain" ? btn("Открыть", () => go("brain"), { small: true }) : null;
    const li = el("li", { cls: `mod-card ${m.status}`, attrs: { "data-depth": String(m.depth) } },
      el("div", { cls: "mod-main" },
        el("div", { cls: "mod-title" }, dot(TONE[m.status]), el("strong", { textContent: m.title }), m.title !== m.name ? el("code", { textContent: m.name }) : null,
          el("span", { cls: `tag ${m.status === "started" ? "ok" : m.status === "failed" ? "danger" : "warn"}`, textContent: STATUS_TEXT[m.status] })),
        m.note ? el("p", { cls: "muted mod-note", textContent: m.note }) : null,
        m.deps.length ? el("div", { cls: "mod-deps" }, icon("chevron", 14), el("span", { cls: "muted", textContent: "зависит от" }), ...m.deps.map((x) => el("code", { textContent: x }))) : null),
      action);
    li.style.marginLeft = m.depth * 22 + "px";
    return li;
  };

  return el("div", { cls: "page" },
    pageHead("modules", "Модули", "Из чего состоит JUUNIBI и в каком состоянии каждая часть. Помощница видит тот же список.", summary),
    items.length ? el("ul", { cls: "mod-list" }, ...items.map(card)) : emptyState("modules", "Нет данных", "Сервер ещё не вернул список модулей."));
}
