import { api } from "../api";
import { relTime } from "../chat/helpers";
import { el, icon, iconButton } from "../dom";
import { refreshMemory, type AppState } from "../state";
import { KIND_LABEL, filterMemory, memoryCounts, type MemFilter } from "./models";
import { btn, chip, emptyState } from "./kit";

const UI = { filter: "all" as MemFilter, query: "", flash: "" };

/** Everything about the long-term memory without a page header: it is shown in a window on the Brain page. */
export function memoryPanel(s: AppState): HTMLElement {
  const counts = memoryCounts(s.memory);
  const root = el("div", { cls: "mem-panel" });
  const listHost = el("div", { cls: "mem-list" });
  const chipsHost = el("div", { cls: "chips", attrs: { role: "group", "aria-label": "Фильтр памяти" } });
  const flash = el("p", { cls: "flash", attrs: { role: "status" }, textContent: UI.flash });

  const act = async (fn: () => Promise<unknown>, msg = "") => { await fn(); UI.flash = msg; await refreshMemory(); };

  const card = (m: AppState["memory"][number]) => {
    const pending = m.status === "pending";
    const tools = el("div", { cls: "mem-tools" });
    if (pending) tools.append(btn("Принять", () => void act(() => api.approve(m.id), "Запомнено."), { primary: true, small: true }), btn("Отклонить", () => void act(() => api.forget(m.id)), { small: true }));
    else tools.append(iconButton("trash", `Забыть: ${m.text}`, () => { if (confirm("Удалить эту запись из памяти?")) void act(() => api.forget(m.id)); }, "icon-btn sm"));
    return el("article", { cls: "mem-card" + (pending ? " pending" : "") },
      el("span", { cls: `mem-kind ${m.kind}`, textContent: KIND_LABEL[m.kind] ?? m.kind }),
      el("p", { cls: "mem-text", textContent: m.text }),
      el("footer", {}, el("span", { cls: "muted", textContent: [pending ? "ждёт подтверждения" : "", m.createdAt ? relTime(m.createdAt) : "", m.score ? `полезность ${m.score > 0 ? "+" : ""}${m.score}` : ""].filter(Boolean).join(" · ") }), tools));
  };

  const renderList = () => {
    const rows = filterMemory(s.memory, UI.filter, UI.query);
    const pend = rows.filter((m) => m.status === "pending");
    const act2 = rows.filter((m) => m.status === "active");
    listHost.replaceChildren();
    if (!rows.length) {
      listHost.append(s.memory.length ? emptyState("search", "Ничего не найдено", "Измените запрос или фильтр.")
        : emptyState("memory", "Память пуста", "Добавьте что-нибудь вручную или попросите помощницу: «Запомни, что я люблю чай». Её собственные «уроки» тоже попадут сюда — на ваше подтверждение."));
      return;
    }
    if (pend.length) {
      const all = btn(`Принять все (${pend.length})`, () => void act(async () => { for (const m of pend) await api.approve(m.id); }, "Всё принято."), { primary: true, small: true });
      listHost.append(el("section", { cls: "mem-block pend" }, el("div", { cls: "mem-block-head" }, icon("alert", 18), el("h2", { textContent: "Ждут вашего решения" }), el("span", { cls: "grow" }), all), ...pend.map(card)));
    }
    if (act2.length) listHost.append(el("section", { cls: "mem-block" }, pend.length ? el("div", { cls: "mem-block-head" }, el("h2", { textContent: "В памяти" })) : null, ...act2.map(card)));
  };
  const renderChips = () => {
    const opt: [MemFilter, string, number][] = [["all", "Все", counts.all], ["pending", "Ждут решения", counts.pending], ["fact", "Факты", counts.fact], ["preference", "Предпочтения", counts.preference], ["lesson", "Уроки", counts.lesson]];
    chipsHost.replaceChildren(...opt.map(([f, label, n]) => chip(label, n, UI.filter === f, () => { UI.filter = f; renderChips(); renderList(); })));
  };

  // add form
  const text = el("input", { type: "text", maxLength: 500, placeholder: "Например: «Я предпочитаю короткие ответы»", cls: "mem-input", attrs: { "aria-label": "Новая запись памяти" } });
  const kind = el("select", { cls: "mem-select", attrs: { "aria-label": "Тип записи" } }, el("option", { value: "fact", textContent: "Факт" }), el("option", { value: "preference", textContent: "Предпочтение" }));
  const add = btn("Запомнить", () => {}, { primary: true });
  add.type = "submit";
  const form = el("form", { cls: "mem-add" }, text, kind, add);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = text.value.trim();
    if (!t) return;
    add.disabled = true;
    const r = await api.addMemory(t, kind.value === "preference" ? "preference" : "fact");
    add.disabled = false;
    if (r.ok) { text.value = ""; UI.flash = "Запомнено."; await refreshMemory(); } else flash.textContent = r.error.message;
  });

  const search = el("input", { type: "search", placeholder: "Поиск по памяти", value: UI.query, cls: "mem-search", attrs: { "aria-label": "Поиск по памяти" } });
  search.addEventListener("input", () => { UI.query = search.value; renderList(); });

  renderChips(); renderList();
  root.append(
    el("section", { cls: "pg-card" }, el("h2", { textContent: "Добавить вручную" }), form, flash),
    el("div", { cls: "mem-toolbar" }, search, chipsHost),
    listHost);
  return root;
}
