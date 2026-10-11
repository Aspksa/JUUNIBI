/** Small windows of the Disk instead of the browser's prompt() and confirm(): a name, a yes/no, a folder. */
import { el } from "../dom";
import { dIcon } from "./disk-icons";
import { btn } from "./kit";
import { openSheet } from "./sheet";
import type { IconName } from "../dom";

/** A name field; Enter saves, Esc or the cross gives null. The base name is selected, not the extension. */
export function askText(o: { title: string; label: string; value?: string; ok: string; icon?: IconName; keepExt?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const input = el("input", { type: "text", cls: "mem-input", value: o.value ?? "", maxLength: 180, attrs: { "aria-label": o.label } });
    const note = el("small", { cls: "dk-form-note", attrs: { "aria-live": "polite" } });
    const finish = (v: string | null) => { if (done) return; done = true; sheet.close(); resolve(v); };
    const save = () => { const v = input.value.trim(); if (!v) { note.textContent = "Введите название"; return; } finish(v); };
    const form = el("form", { cls: "dk-form" }, el("label", { cls: "dk-form-label", textContent: o.label }), input, note,
      el("div", { cls: "dk-form-actions" }, btn("Отмена", () => finish(null)), btn(o.ok, () => save(), { primary: true })));
    form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
    const sheet = openSheet({ title: o.title, icon: o.icon ?? "edit", content: form, onClose: () => { if (!done) { done = true; resolve(null); } } });
    form.closest(".mod-sheet")?.classList.add("dk-small-sheet");
    requestAnimationFrame(() => {
      input.focus();
      const dot = o.keepExt ? input.value.lastIndexOf(".") : -1;
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    });
  });
}

/** A yes/no with the consequence spelled out; the risky answer is red. */
export function askConfirm(o: { title: string; text: string; ok: string; danger?: boolean; icon?: IconName }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (done) return; done = true; sheet.close(); resolve(v); };
    const okBtn = btn(o.ok, () => finish(true), { primary: !o.danger, danger: !!o.danger });
    const body = el("div", { cls: "dk-form" }, el("p", { cls: "dk-confirm-text", textContent: o.text }),
      el("div", { cls: "dk-form-actions" }, btn("Отмена", () => finish(false)), okBtn));
    const sheet = openSheet({ title: o.title, icon: o.icon ?? (o.danger ? "trash" : "help"), tone: o.danger ? "bad" : "ok", content: body, onClose: () => { if (!done) { done = true; resolve(false); } } });
    body.closest(".mod-sheet")?.classList.add("dk-small-sheet");
    requestAnimationFrame(() => okBtn.focus());
  });
}

/**
 * Where to put files or a folder: a searchable list with the tree's indentation.
 * `moving` hides the folder itself and its subfolders; `start` is pre-selected.
 */
export function pickFolder(o: { folders: string[]; title: string; ok: string; start: string; moving?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false, chosen = o.start;
    const search = el("input", { type: "search", cls: "mem-input", placeholder: "Найти папку", attrs: { "aria-label": "Найти папку" } });
    const list = el("div", { cls: "dk-dest-list", attrs: { role: "listbox", "aria-label": "Папки" } });
    const okBtn = btn(o.ok, () => finish(chosen), { primary: true });
    const finish = (v: string | null) => { if (done) return; done = true; sheet.close(); resolve(v); };
    const draw = () => {
      const q = search.value.trim().toLocaleLowerCase();
      const all = ["", ...[...o.folders].sort((a, b) => a.localeCompare(b, "ru"))]
        .filter((f) => !o.moving || (f !== o.moving && !f.startsWith(o.moving + "/")))
        .filter((f) => !q || !f || f.toLocaleLowerCase().includes(q));
      list.replaceChildren(...all.map((f) => {
        const depth = f ? f.split("/").length - 1 : 0;
        const item = el("button", { type: "button", cls: "dk-dest" + (f === chosen ? " on" : ""), attrs: { role: "option", "aria-selected": String(f === chosen) } },
          dIcon(f ? "folder" : "disk", 17), el("span", { textContent: f ? (q ? f : f.split("/").pop()!) : "Корень Диска" }),
          f === chosen ? dIcon("check", 16) : null);
        if (!q) item.style.paddingLeft = 10 + depth * 16 + "px";
        item.addEventListener("click", () => { chosen = f; draw(); });
        item.addEventListener("dblclick", () => finish(f));
        return item;
      }));
    };
    search.addEventListener("input", draw);
    search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(chosen); } });
    draw();
    const body = el("div", { cls: "dk-form disk-destination-dialog" }, search, list,
      el("div", { cls: "dk-form-actions" }, btn("Отмена", () => finish(null)), okBtn));
    const sheet = openSheet({ title: o.title, icon: "folder", content: body, onClose: () => { if (!done) { done = true; resolve(null); } } });
    body.closest(".mod-sheet")?.classList.add("dk-small-sheet");
    requestAnimationFrame(() => search.focus());
  });
}
