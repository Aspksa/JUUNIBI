/** The upload panel: one row per file with its progress, a cancel, then ✓ or the reason it failed. */
import type { DiskUploaded } from "../api";
import { el, iconButton } from "../dom";
import { fileBadge } from "./disk-icons";
import { human } from "./disk-model";

const LIMIT = 500 * 1024 * 1024;
type Row = { file: File; folder: string; root: HTMLElement; bar: HTMLElement; note: HTMLElement; state: "wait" | "run" | "ok" | "fail" | "off"; xhr?: XMLHttpRequest };

export interface Uploader {
  readonly root: HTMLElement;
  add(files: File[], folder: string): void;
  /** One batch with a folder per file (a dropped folder tree). */
  addMany(items: { file: File; folder: string }[]): void;
  readonly busy: boolean;
}
export function createUploader(o: { onUploaded: (f: DiskUploaded) => void; onIdle: () => void }): Uploader {
  const rows: Row[] = [];
  const title = el("strong", { textContent: "Загрузка" });
  const sub = el("small", { cls: "muted" });
  const list = el("div", { cls: "dk-up-list" });
  const close = iconButton("x", "Скрыть", () => { if (!running()) { rows.length = 0; list.replaceChildren(); root.hidden = true; } }, "icon-btn sm");
  const cancelAll = el("button", { type: "button", cls: "btn sm", textContent: "Отменить всё" });
  cancelAll.addEventListener("click", () => { for (const r of rows) stop(r); });
  const root = el("section", { cls: "dk-up", attrs: { "aria-label": "Загрузка файлов", "aria-live": "polite" } },
    el("header", {}, el("div", { cls: "dk-up-title" }, title, sub), cancelAll, close), list);
  root.hidden = true;
  let active = false;
  const running = () => rows.some((r) => r.state === "wait" || r.state === "run");
  const summary = () => {
    const ok = rows.filter((r) => r.state === "ok").length, fail = rows.filter((r) => r.state === "fail").length;
    const left = rows.filter((r) => r.state === "wait" || r.state === "run").length;
    title.textContent = left ? "Загружается " + (rows.length - left + 1) + " из " + rows.length : fail ? "Готово с ошибками" : "Готово";
    sub.textContent = [ok ? "✓ " + ok : "", fail ? "ошибок: " + fail : ""].filter(Boolean).join(" · ");
    cancelAll.hidden = !left;
    close.disabled = !!left;
    root.classList.toggle("done", !left);
  };
  const mark = (r: Row, state: Row["state"], note: string) => {
    r.state = state; r.note.textContent = note;
    r.root.className = "dk-up-row " + state;
    summary();
  };
  const stop = (r: Row) => {
    if (r.state === "wait") mark(r, "off", "Отменено");
    else if (r.state === "run") r.xhr?.abort();
  };
  const send = (r: Row) => new Promise<void>((resolve) => {
    const xhr = new XMLHttpRequest();
    r.xhr = xhr;
    xhr.open("POST", "/api/disk/files/binary?name=" + encodeURIComponent(r.file.name) + "&folder=" + encodeURIComponent(r.folder));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const p = Math.round((e.loaded / e.total) * 100); r.bar.style.width = p + "%"; r.note.textContent = p + "%"; } };
    xhr.onload = () => {
      if (xhr.status === 201) {
        r.bar.style.width = "100%";
        mark(r, "ok", human(r.file.size));
        try { o.onUploaded(JSON.parse(xhr.responseText) as DiskUploaded); } catch { /* listed on the next refresh */ }
      } else {
        let why = "Не загрузилось";
        try { why = (JSON.parse(xhr.responseText) as { error?: string }).error ?? why; } catch { /* keep the default */ }
        mark(r, "fail", why);
      }
      resolve();
    };
    xhr.onerror = () => { mark(r, "fail", "Нет связи с JUUNIBI"); resolve(); };
    xhr.onabort = () => { mark(r, "off", "Отменено"); resolve(); };
    mark(r, "run", "0%");
    xhr.send(r.file);
  });
  const pump = async () => {
    if (active) return;
    active = true;
    try { for (let r = rows.find((x) => x.state === "wait"); r; r = rows.find((x) => x.state === "wait")) await send(r); }
    finally {
      active = false; o.onIdle();
      // a clean batch tidies itself away; errors stay until the owner reads them
      if (rows.every((r) => r.state === "ok")) setTimeout(() => { if (!running() && rows.every((r) => r.state === "ok")) root.hidden = true; }, 4000);
    }
  };
  return {
    root,
    get busy() { return running(); },
    add(files, folder) { this.addMany(files.map((file) => ({ file, folder }))); },
    addMany(items) {
      if (!items.length) return;
      if (!running()) { rows.length = 0; list.replaceChildren(); }
      for (const { file, folder } of items) {
        const bar = el("i");
        const note = el("small", { cls: "muted" });
        const row: Row = { file, folder, bar, note, state: "wait", root: el("div", { cls: "dk-up-row wait" }) };
        const x = iconButton("x", "Отменить " + file.name, () => stop(row), "icon-btn sm dk-up-stop");
        row.root.append(fileBadge(file.name, 28), el("div", { cls: "dk-up-info" },
          el("span", { cls: "dk-up-name", textContent: file.name, title: (folder ? folder + "/" : "") + file.name }), el("span", { cls: "dk-up-bar" }, bar), note), x);
        rows.push(row); list.append(row.root);
        if (!file.size) mark(row, "fail", "Пустой файл");
        else if (file.size > LIMIT) mark(row, "fail", "Больше 500 МБ");
        else note.textContent = "В очереди";
      }
      root.hidden = false;
      summary();
      void pump();
    },
  };
}

/** Every file of dropped folders with its path inside them («Фото/2024/a.jpg»); stops after `max` files, so a caller seeing `max` knows the folder is bigger. */
export async function readDropped(items: DataTransferItem[], max = 10001): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = [];
  const entries = items.map((it) => it.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (out.length >= max) return;
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries hands out a batch at a time (100 in Chrome) until it returns none
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, prefix + entry.name + "/");
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}
