/** Small windows of the Disk instead of the browser's prompt() and confirm(): a name, a yes/no, a folder. */
import { el } from "../dom";
import type { DiskFile, Note, ProjectMeta } from "../api";
import { dIcon, fileBadge } from "./disk-icons";
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

/** Which to-do or project a file goes to: open to-dos first by due date, then projects; a search narrows both. */
export function pickTask(o: { notes: Note[]; projects: ProjectMeta[]; title: string }): Promise<{ kind: "task"; id: string } | { kind: "project"; name: string } | null> {
  return new Promise((resolve) => {
    let done = false;
    const open = o.notes.filter((n) => n.kind === "todo" && !n.done && !n.auto)
      .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
    const names = new Map<string, string>();
    for (const p of o.projects) names.set(p.name.toLowerCase(), p.name);
    for (const n of o.notes) if (n.project && !/^[0-9a-f-]{36}$/.test(n.project)) names.set(n.project.toLowerCase(), names.get(n.project.toLowerCase()) ?? n.project);
    const projects = [...names.values()].sort((a, b) => a.localeCompare(b, "ru"));
    const search = el("input", { type: "search", cls: "mem-input", placeholder: "Найти дело или проект", attrs: { "aria-label": "Найти дело или проект" } });
    const list = el("div", { cls: "dk-dest-list", attrs: { role: "listbox", "aria-label": "Дела и проекты" } });
    const finish = (v: Parameters<typeof resolve>[0]) => { if (done) return; done = true; sheet.close(); resolve(v); };
    const item = (ic: Parameters<typeof dIcon>[0], label: string, sub: string, run: () => void) => {
      const b = el("button", { type: "button", cls: "dk-dest dk-dest-task", attrs: { role: "option", "aria-selected": "false" } }, dIcon(ic, 17),
        el("span", { cls: "dk-dest-text" }, el("span", { textContent: label }), sub ? el("small", { cls: "muted", textContent: sub }) : null));
      b.addEventListener("click", run);
      return b;
    };
    const draw = () => {
      const q = search.value.trim().toLocaleLowerCase();
      const tasks = open.filter((n) => !q || n.text.toLocaleLowerCase().includes(q) || (n.project ?? "").toLocaleLowerCase().includes(q)).slice(0, 60);
      const projs = projects.filter((p) => !q || p.toLocaleLowerCase().includes(q));
      list.replaceChildren(
        ...(tasks.length ? [el("div", { cls: "dk-dest-sep", textContent: "Дела" })] : []),
        ...tasks.map((n) => item("check", n.text, [n.dueAt ? "срок " + new Date(n.dueAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "", n.project && !/^[0-9a-f-]{36}$/.test(n.project) ? "#" + n.project : "", n.files?.length ? "файлов: " + n.files.length : ""].filter(Boolean).join(" · "), () => finish({ kind: "task", id: n.id }))),
        ...(projs.length ? [el("div", { cls: "dk-dest-sep", textContent: "Проекты" })] : []),
        ...projs.map((p) => item("folder", "#" + p, (() => { const m = o.projects.find((x) => x.name.toLowerCase() === p.toLowerCase()); return m?.files?.length ? "файлов: " + m.files.length : ""; })(), () => finish({ kind: "project", name: p }))),
        ...(!tasks.length && !projs.length ? [el("p", { cls: "muted small", textContent: q ? "Ничего не нашлось." : "Открытых дел и проектов пока нет." })] : []));
    };
    search.addEventListener("input", draw);
    draw();
    const body = el("div", { cls: "dk-form" }, search, list, el("div", { cls: "dk-form-actions" }, btn("Отмена", () => finish(null))));
    const sheet = openSheet({ title: o.title, icon: "check", content: body, onClose: () => { if (!done) { done = true; resolve(null); } } });
    body.closest(".mod-sheet")?.classList.add("dk-small-sheet");
    requestAnimationFrame(() => search.focus());
  });
}

/** A file from «Диск» to attach somewhere else (a to-do, a project): searchable, newest first. */
export function pickDiskFile(o: { files: DiskFile[]; title: string; have?: string[] }): Promise<DiskFile | null> {
  return new Promise((resolve) => {
    let done = false;
    const search = el("input", { type: "search", cls: "mem-input", placeholder: "Найти файл", attrs: { "aria-label": "Найти файл" } });
    const list = el("div", { cls: "dk-dest-list", attrs: { role: "listbox", "aria-label": "Файлы" } });
    const finish = (v: DiskFile | null) => { if (done) return; done = true; sheet.close(); resolve(v); };
    const sorted = [...o.files].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    const draw = () => {
      const q = search.value.trim().toLocaleLowerCase();
      const shown = sorted.filter((f) => !q || (f.name + " " + f.folder + " " + (f.tags ?? []).join(" ")).toLocaleLowerCase().includes(q)).slice(0, 80);
      list.replaceChildren(...shown.map((f) => {
        const have = o.have?.includes(f.id);
        const b = el("button", { type: "button", cls: "dk-dest dk-dest-task", disabled: !!have, attrs: { role: "option", "aria-selected": "false" } }, fileBadge(f.name, 24),
          el("span", { cls: "dk-dest-text" }, el("span", { textContent: f.name }), el("small", { cls: "muted", textContent: (f.folder || "Корень") + (have ? " · уже прикреплён" : "") })));
        b.addEventListener("click", () => finish(f));
        return b;
      }), ...(!shown.length ? [el("p", { cls: "muted small", textContent: o.files.length ? "Ничего не нашлось." : "На Диске пока нет файлов." })] : []));
    };
    search.addEventListener("input", draw);
    draw();
    const body = el("div", { cls: "dk-form" }, search, list, el("div", { cls: "dk-form-actions" }, btn("Отмена", () => finish(null))));
    const sheet = openSheet({ title: o.title, icon: "file", content: body, onClose: () => { if (!done) { done = true; resolve(null); } } });
    body.closest(".mod-sheet")?.classList.add("dk-small-sheet");
    requestAnimationFrame(() => search.focus());
  });
}

/** Several files of «Диск» at once (for the chat): tick up to `max`, newest first, searchable. */
export function pickDiskFiles(o: { files: DiskFile[]; title: string; max: number; ok: string }): Promise<DiskFile[]> {
  return new Promise((resolve) => {
    let done = false;
    const picked = new Set<string>();
    const search = el("input", { type: "search", cls: "mem-input", placeholder: "Найти файл", attrs: { "aria-label": "Найти файл" } });
    const list = el("div", { cls: "dk-dest-list", attrs: { role: "listbox", "aria-multiselectable": "true", "aria-label": "Файлы" } });
    const ok = btn(o.ok, () => finish(o.files.filter((f) => picked.has(f.id))), { primary: true });
    const finish = (v: DiskFile[]) => { if (done) return; done = true; sheet.close(); resolve(v); };
    const draw = () => {
      const q = search.value.trim().toLocaleLowerCase();
      const shown = o.files.filter((f) => !q || (f.name + " " + f.folder + " " + (f.tags ?? []).join(" ")).toLocaleLowerCase().includes(q)).slice(0, 120);
      list.replaceChildren(...shown.map((f) => {
        const on = picked.has(f.id);
        const b = el("button", { type: "button", cls: "dk-dest dk-dest-task" + (on ? " on" : ""), disabled: !on && picked.size >= o.max, attrs: { role: "option", "aria-selected": String(on) } },
          el("input", { type: "checkbox", checked: on, tabIndex: -1, attrs: { "aria-hidden": "true" } }), fileBadge(f.name, 24),
          el("span", { cls: "dk-dest-text" }, el("span", { textContent: f.name }), el("small", { cls: "muted", textContent: f.folder || "Корень" })));
        b.addEventListener("click", () => { if (on) picked.delete(f.id); else picked.add(f.id); draw(); });
        return b;
      }), ...(!shown.length ? [el("p", { cls: "muted small", textContent: o.files.length ? "Ничего не нашлось." : "На Диске пока нет файлов." })] : []));
      ok.disabled = !picked.size;
      ok.textContent = picked.size ? `${o.ok} (${picked.size})` : o.ok;
    };
    search.addEventListener("input", draw);
    draw();
    const body = el("div", { cls: "dk-form" }, search, el("p", { cls: "muted small", textContent: `Можно выбрать до ${o.max} файлов: текст, PDF, Word, Excel, PowerPoint.` }), list,
      el("div", { cls: "dk-form-actions" }, btn("Отмена", () => finish([])), ok));
    const sheet = openSheet({ title: o.title, icon: "folder", content: body, onClose: () => { if (!done) { done = true; resolve([]); } } });
    body.closest(".mod-sheet")?.classList.add("dk-small-sheet");
    requestAnimationFrame(() => search.focus());
  });
}
