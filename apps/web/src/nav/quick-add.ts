/**
 * «+» in the menu: adds a to-do, a reminder or a note from any page, with the same one-line Russian
 * input as the «Дела» page («завтра в 10 позвонить маме»).
 */
import { el } from "../dom";
import { btn } from "../pages/kit";
import { parseQuick, type QuickKind } from "../pages/quick-entry";
import { openSheet } from "../pages/sheet";
import { describeQuick, saveQuick, savedText, withWhen } from "../pages/tasks";
import { toLocalInput } from "../pages/tasks-model";
import { refreshBrief } from "../state";
import { showToast } from "../toast";

const KINDS: [QuickKind, string][] = [["auto", "Авто"], ["todo", "Дело"], ["reminder", "Напоминание"], ["note", "Заметка"]];

export function openQuickAdd(onSaved: () => void, initial = "") {
  let kind: QuickKind = "auto";
  const text = el("input", { type: "text", maxLength: 500, value: initial, cls: "mem-input", placeholder: "Например: завтра в 10 позвонить маме", enterKeyHint: "done", attrs: { "aria-label": "Новое дело, напоминание или заметка", "aria-describedby": "qa-preview" } });
  const preview = el("p", { cls: "muted small qa-preview", id: "qa-preview", attrs: { "aria-live": "polite" } });
  const at = el("input", { type: "datetime-local", cls: "mem-select", attrs: { "aria-label": "Когда напомнить" } });
  const when = el("div", { cls: "qa-when" }, el("span", { cls: "muted small", textContent: "Когда напомнить" }), at);
  const kinds = el("div", { cls: "segmented qa-kinds", attrs: { role: "radiogroup", "aria-label": "Что добавить" } });
  const add = btn("Добавить", () => {}, { primary: true, icon: "plus" });
  add.type = "submit";

  const parsed = () => parseQuick(text.value, new Date(), kind);
  const needWhen = () => { const p = parsed(); return p.kind === "reminder" && !p.at; };
  const sync = () => {
    when.hidden = !needWhen();
    if (!when.hidden && !at.value) at.value = toLocalInput(new Date(Date.now() + 3_600_000).toISOString());
    preview.textContent = text.value.trim() ? describeQuick(parsed()) : "Время и повтор понимаются из текста: «по будням в 10 стендап», «заметка: идеи подарка».";
  };
  const drawKinds = () => kinds.replaceChildren(...KINDS.map(([k, label]) => {
    const b = el("button", { type: "button", textContent: label, attrs: { role: "radio", "aria-checked": String(kind === k) } });
    b.addEventListener("click", () => { kind = k; drawKinds(); sync(); text.focus(); });
    return b;
  }));
  text.addEventListener("input", sync);
  drawKinds(); sync();

  const form = el("form", { cls: "qa-form" }, el("div", { cls: "qa-row" }, text, add), preview, kinds, when);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!text.value.trim()) { text.focus(); return; }
    let p = parsed();
    if (needWhen()) {
      const d = new Date(at.value);
      if (!at.value || Number.isNaN(d.getTime())) { showToast("Укажите дату и время."); at.focus(); return; }
      p = withWhen(p, d.toISOString(), "none");
    }
    add.disabled = true;
    const r = await saveQuick(p);
    add.disabled = false;
    if (!r.ok) { showToast(r.error?.message ?? "Не получилось", { ms: 8000 }); return; }
    showToast(savedText(p), { ms: 2500 });
    void refreshBrief();
    sheet.close();
    onSaved();
  });
  const sheet = openSheet({ title: "Добавить", icon: "plus", tone: "warn", sub: "Дело, напоминание или заметка", content: form });
  text.focus();
}
