/**
 * «Диск»: the owner's files on this computer. One tool row, the folder tree on the left
 * (a slide-out drawer on a phone), the files in the middle and «Сведения» on the right.
 * Actions change the list in place and answer with a toast that can undo them; only folder
 * operations fetch the catalogue again. Pictures are plain lazy <img> links to the raw file.
 */
import { api, diskRawUrl, diskThumbUrl, type DiskFile, type DiskPreview, type DiskUploaded, type Note } from "../api";
import { renderMarkdown } from "../markdown";
import { thumbReady, wantThumb } from "./disk-thumbs";
import { DISK_DRAG, takeDiskLink } from "./disk-link";
import { el, iconButton } from "../dom";
import { showToast } from "../toast";
import { diskLifePanel } from "./disk-life";
import { askConfirm, askText, pickFolder, pickTask } from "./disk-dialogs";
import { dIcon, fileBadge, KIND_COLOR, type DiskIconName } from "./disk-icons";
import {
  askable, daysLeft, duplicateNote, filterFiles, folderChildren, folderName, folderTotals, groupLabel, hasThumb, human,
  folderPlan, kindOf, madeThumb, matchesVirtual, moveBack, parentOf, parseCsv, plural, previewKind, files as filesWord,
  type GroupKey, type SortKey, type Virtual,
} from "./disk-model";
import { createUploader, readDropped } from "./disk-upload";
import { btn, emptyState } from "./kit";
import { openSheet } from "./sheet";
import "./disk.css";

export interface DiskDeps {
  /** Opens a fresh chat with the file attached as text and sends the question. */
  ask?: (name: string, text: string, question: string) => void;
  /** Attaches files' text to the chat composer and opens the chat; returns why it could not. */
  attach?: (files: { name: string; size: number; text: string }[]) => string | null;
}
type View = "all" | "favorites" | "trash";
type Mode = "tiles" | "large" | "list" | "table";
type Style = { color: string; pinned: boolean; cover: string; createdAt?: string };
type MenuItem = { icon: DiskIconName; label: string; run: () => void; danger?: boolean; hint?: string } | "-";

const MODES: { id: Mode; icon: DiskIconName; label: string }[] = [
  { id: "tiles", icon: "tiles", label: "Плитка" }, { id: "large", icon: "large", label: "Крупные плитки" },
  { id: "list", icon: "listView", label: "Список" }, { id: "table", icon: "table", label: "Таблица" },
];
const SECTIONS: { id: Virtual | "favorites" | "trash"; icon: DiskIconName; label: string }[] = [
  { id: "favorites", icon: "star", label: "Избранное" }, { id: "recent", icon: "recent", label: "Недавние" },
  { id: "images", icon: "image", label: "Изображения" }, { id: "documents", icon: "docs", label: "Документы" },
  { id: "large", icon: "heavy", label: "Крупные файлы" }, { id: "trash", icon: "trash", label: "Корзина" },
];
const VIRTUAL_TITLE: Record<Exclude<Virtual, "none">, string> = { images: "Изображения", documents: "Документы", large: "Крупные файлы", recent: "Недавние · 7 дней" };
const FOLDER_ACTION: Record<string, string> = { create: "Создана папка", rename: "Папка переименована", copy: "Папка скопирована", trash: "Папка в корзине", restore: "Папка восстановлена", style: "Оформление папки", move: "Папка перемещена" };
const PAGE = 150;
/** The «Корзина» section accepts dragged files: they go to the trash. */
const TRASH_DROP = "\u0000trash";
const ib = (ic: DiskIconName, label: string, run: () => void) => {
  const b = el("button", { type: "button", cls: "icon-btn", title: label, attrs: { "aria-label": label } }, dIcon(ic, 18));
  b.addEventListener("click", run);
  return b;
};
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

/* ---------------------------------------------------------------- one shared pop-up menu */
let menuEl: HTMLElement | null = null;
let menuCleanup: (() => void) | null = null;
function closeMenu() { menuCleanup?.(); menuCleanup = null; menuEl?.remove(); menuEl = null; }
/** A small menu next to `anchor` (or at the pointer). Built only when opened; arrows, Enter and Esc work. */
function openMenu(anchor: HTMLElement | { x: number; y: number }, items: MenuItem[], label: string) {
  closeMenu();
  const box = el("div", { cls: "dk-menu", attrs: { role: "menu", "aria-label": label } });
  for (const it of items) {
    if (it === "-") { box.append(el("hr")); continue; }
    const b = el("button", { type: "button", cls: "dk-menu-item" + (it.danger ? " danger" : ""), attrs: { role: "menuitem" } },
      dIcon(it.icon, 17), el("span", { textContent: it.label }), it.hint ? el("kbd", { textContent: it.hint }) : null);
    b.addEventListener("click", () => { closeMenu(); it.run(); });
    box.append(b);
  }
  document.body.append(box);
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = box.offsetWidth, h = box.offsetHeight;
  const left = Math.min(Math.max(8, (anchor instanceof HTMLElement ? r.right - w : r.left)), innerWidth - w - 8);
  const top = r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
  box.style.left = left + "px"; box.style.top = top + "px";
  const buttons = [...box.querySelectorAll<HTMLButtonElement>("button")];
  buttons[0]?.focus();
  const opener = anchor instanceof HTMLElement ? anchor : null;
  opener?.setAttribute("aria-expanded", "true");
  const onDown = (e: Event) => { if (!box.contains(e.target as Node) && e.target !== opener && !opener?.contains(e.target as Node)) closeMenu(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); opener?.focus(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  };
  const onScroll = () => closeMenu();
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  addEventListener("resize", onScroll);
  document.querySelector(".content")?.addEventListener("scroll", onScroll, { passive: true });
  menuEl = box;
  menuCleanup = () => {
    opener?.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("resize", onScroll);
    document.querySelector(".content")?.removeEventListener("scroll", onScroll);
  };
}

export function diskPage(deps: DiskDeps = {}): HTMLElement {
  /* ---------------------------------------------------------------- state */
  let folders: string[] = [], all: DiskFile[] = [], trash: DiskFile[] = [], used = 0, maxBytes = 500 * 1024 * 1024;
  let styles: Record<string, Style> = {};
  let keepDays = 30, loaded = false;
  let current = "", view: View = "all", virtual: Virtual = "none", everywhere = false;
  let mode: Mode = ((m) => (MODES.some((x) => x.id === m) ? m : "tiles"))(store.get("juunibi.disk.view")) as Mode;
  let sort: SortKey = (["new", "old", "name", "size"] as const).find((s) => s === store.get("juunibi.disk.sort")) ?? "new";
  let groupBy: GroupKey = "none", limit = PAGE;
  let query = "", inText = false, contentIds: Set<string> | null = null;
  let ext = "", minKb: number | null = null, maxKb: number | null = null, after = "";
  const selected = new Set<string>();
  let anchorId: string | null = null, focusId: string | null = null, infoId: string | null = null;
  let clipboard: { ids: string[]; cut: boolean } | null = null;
  const expanded = new Set<string>(JSON.parse(store.get("juunibi.disk.open") ?? "[]") as string[]);
  let treeSort: "pinned" | "name" | "files" | "size" | "created" = "pinned", treeQuery = "";
  let treeHidden = store.get("juunibi.disk.tree") === "hidden";
  let shown: DiskFile[] = [];

  const page = el("div", { cls: "page disk-page" });
  const byId = (id: string) => all.find((f) => f.id === id) ?? trash.find((f) => f.id === id);
  const uploadFolder = () => (view === "all" && virtual === "none" ? current : "");

  /* ---------------------------------------------------------------- uploads */
  const picker = el("input", { type: "file", multiple: true, hidden: true, attrs: { "aria-hidden": "true", tabindex: "-1" } });
  picker.addEventListener("change", () => { uploader.add([...(picker.files ?? [])], uploadFolder()); picker.value = ""; });
  const chooseFiles = () => picker.click();
  /** «Загрузить папку»: the browser hands over every file with its path inside the chosen folder. */
  const folderPicker = el("input", { type: "file", multiple: true, hidden: true, attrs: { "aria-hidden": "true", tabindex: "-1", webkitdirectory: "", directory: "" } });
  folderPicker.addEventListener("change", () => {
    const list = [...(folderPicker.files ?? [])];
    folderPicker.value = "";
    void uploadTree(list.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
  });
  const chooseFolder = () => folderPicker.click();
  /** A dropped or chosen folder: its subfolders are made on the Disk first, then the files go into them. */
  async function uploadTree(items: { file: File; path: string }[]) {
    if (!items.length) return;
    // Better to refuse up front than to copy part of a folder and look finished.
    const room = 10000 - all.length - trash.length; // the trash counts toward the limit on the server too
    if (items.length > room) { showToast(items.length > 10000 ? "В папке больше 10 000 файлов: столько на Диск не поместится" : "Не хватит места: на Диске до 10 000 файлов, свободно " + Math.max(0, room)); return; }
    if (!items.some((x) => x.path.includes("/"))) { uploader.add(items.map((x) => x.file), uploadFolder()); return; }
    const base = uploadFolder();
    const plan = folderPlan(items.map((x) => x.path), base);
    const missing = plan.folders.filter((f) => !folders.includes(f) && f !== base);
    if (folders.length + missing.length > 500) { showToast("Столько папок не поместится: на Диске до 500 папок"); return; }
    if (missing.length) showToast("Создаю папки: " + missing.length);
    for (const f of missing) {
      const r = await api.diskFolder(f);
      if (!r.ok && !/уже есть/i.test(r.error.message)) { showToast("Папка «" + f + "»: " + r.error.message); return; }
    }
    if (missing.length) { for (const f of missing) expanded.add(parentOf(f)); saveOpen(); await loadCatalog(); }
    uploader.addMany(plan.files.map((x) => ({ file: items[x.index]!.file, folder: x.folder })));
    const byFolder = new Set(plan.files.map((x) => x.folder));
    const top = plan.folders.find((f) => f !== base && parentOf(f) === base);
    showToast("Загружаю " + filesWord(plan.files.length) + " в " + plural(missing.length || byFolder.size, "папку", "папки", "папок") + (plan.skipped ? ", служебных файлов пропущено: " + plan.skipped : ""),
      top ? { action: { label: "Открыть папку", run: () => go({ folder: top }) } } : undefined);
  }
  const uploader = createUploader({
    onUploaded: (f: DiskUploaded) => {
      const { duplicates, ...entry } = f;
      all = [entry, ...all.filter((x) => x.id !== entry.id)];
      used += entry.size;
      const note = duplicateNote(entry.name, duplicates ?? []);
      if (note) showToast(note, { ms: 12000, actions: [
        { label: "Удалить новый", run: () => void trashFiles([entry.id]) },
        { label: "Показать", run: () => { const t = duplicates[0]!; go({ folder: t.folder }); reveal(t.id); } },
      ] });
      scheduleRedraw();
    },
    onIdle: () => scheduleRedraw(),
  });

  /* ---------------------------------------------------------------- top bar */
  const search = el("input", { type: "search", cls: "dk-search-input", placeholder: "Поиск по названию и меткам", attrs: { "aria-label": "Поиск файлов" } });
  const textChip = el("button", { type: "button", cls: "chip dk-chip", attrs: { "aria-pressed": "false", title: "Искать и внутри текстовых файлов" } }, dIcon("docs", 15), "В тексте");
  const everyChip = el("button", { type: "button", cls: "chip dk-chip", attrs: { "aria-pressed": "false", "aria-label": "Искать по всем папкам" } }, dIcon("folder", 15), "Во всех папках");
  const drawerBtn = el("button", { type: "button", cls: "icon-btn dk-drawer-btn", attrs: { "aria-label": "Папки", title: "Папки" } }, dIcon("drawer", 19));
  const uploadBtn = btn("Загрузить", chooseFiles, { primary: true, icon: "download" });
  uploadBtn.classList.add("dk-upload-btn");
  uploadBtn.querySelector("svg")?.replaceWith(dIcon("upload", 17));
  const newFolderBtn = btn("Новая папка", () => void createFolder(uploadFolder()), {});
  newFolderBtn.classList.add("dk-newfolder-btn");
  newFolderBtn.prepend(dIcon("folderPlus", 17));
  const moreBtn = el("button", { type: "button", cls: "icon-btn dk-more-btn", attrs: { "aria-label": "Ещё", "aria-haspopup": "menu", "aria-expanded": "false", title: "Ещё" } }, dIcon("more", 19));
  moreBtn.addEventListener("click", () => openMenu(moreBtn, [
    { icon: "folderPlus", label: "Новая папка", run: () => void createFolder(uploadFolder()) },
    { icon: "folderUp", label: "Загрузить папку…", run: chooseFolder },
    { icon: "zipDown", label: current && view === "all" && virtual === "none" ? "Скачать папку ZIP-архивом" : "Скачать весь Диск ZIP-архивом", run: () => void downloadZip({ folder: view === "all" && virtual === "none" ? current : "" }) },
    { icon: "chronicle", label: "Жизнь документов", run: () => life.reveal() },
    { icon: "audit", label: "Проверка файлов", run: () => void openAudit() },
    { icon: "history", label: "История", run: () => void openHistory() },
    { icon: "undo", label: "Отменить последнее", run: () => void undoLast() },
    "-",
    { icon: "exportList", label: "Экспорт каталога", run: () => void exportCatalog() },
    { icon: "backup", label: "Резервная копия", run: downloadBackup },
    { icon: "restore", label: "Восстановить из копии", run: () => restorePicker.click() },
    "-",
    { icon: "drawer", label: treeHidden ? "Показать папки" : "Скрыть папки", run: () => { treeHidden = !treeHidden; store.set("juunibi.disk.tree", treeHidden ? "hidden" : ""); layout.classList.toggle("no-tree", treeHidden); } },
  ], "Действия Диска"));
  let searchTimer = 0, contentTimer = 0, searchGen = 0;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { query = search.value; limit = PAGE; renderFiles(); }, 120);
    if (inText) { clearTimeout(contentTimer); contentTimer = window.setTimeout(() => void searchContent(), 320); }
  });
  textChip.addEventListener("click", () => { inText = !inText; textChip.setAttribute("aria-pressed", String(inText)); void searchContent(); });
  everyChip.addEventListener("click", () => { everywhere = !everywhere; everyChip.setAttribute("aria-pressed", String(everywhere)); limit = PAGE; redraw(); });
  const searchContent = async () => {
    const gen = ++searchGen, q = search.value.trim();
    contentIds = null;
    if (inText && q.length >= 2) {
      try {
        const r = await fetch("/api/disk/search?q=" + encodeURIComponent(q));
        if (!r.ok) throw new Error();
        const ids = ((await r.json()) as { ids: string[] }).ids;
        if (gen !== searchGen) return;
        contentIds = new Set(ids);
      } catch { if (gen === searchGen) showToast("Поиск внутри файлов сейчас недоступен"); }
    }
    if (gen === searchGen) { query = search.value; renderFiles(); }
  };
  const bar = el("div", { cls: "dk-bar" },
    drawerBtn,
    el("label", { cls: "dk-search" }, dIcon("search", 18), search, el("span", { cls: "dk-bar-chips" }, textChip, everyChip)),
    el("div", { cls: "dk-bar-actions" }, newFolderBtn, uploadBtn, moreBtn));

  /* ---------------------------------------------------------------- list header: path, sort, view, filters */
  const crumbs = el("nav", { cls: "dk-crumbs", attrs: { "aria-label": "Путь" } });
  const countNote = el("small", { cls: "muted dk-count" });
  const sortSel = el("select", { cls: "dk-select", attrs: { "aria-label": "Порядок файлов" } },
    ...([["new", "Сначала новые"], ["old", "Сначала старые"], ["name", "По имени"], ["size", "По размеру"]] as const).map(([v, t]) => el("option", { value: v, textContent: t })));
  sortSel.value = sort;
  sortSel.addEventListener("change", () => { sort = sortSel.value as SortKey; store.set("juunibi.disk.sort", sort); renderFiles(); });
  const modeBox = el("div", { cls: "dk-modes", attrs: { role: "group", "aria-label": "Вид" } },
    ...MODES.map((m) => {
      const b = el("button", { type: "button", cls: "icon-btn", title: m.label, attrs: { "aria-label": "Вид: " + m.label, "aria-pressed": String(mode === m.id), "data-mode": m.id } }, dIcon(m.icon, 18));
      b.addEventListener("click", () => { mode = m.id; store.set("juunibi.disk.view", mode); for (const x of modeBox.children) x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.mode === mode)); renderFiles(); });
      return b;
    }));
  const num = (label: string) => el("input", { type: "number", min: 0, step: 1, cls: "mem-input", placeholder: label, attrs: { "aria-label": label } });
  const minIn = num("Минимальный размер в КБ"), maxIn = num("Максимальный размер в КБ");
  minIn.placeholder = "от, КБ"; maxIn.placeholder = "до, КБ";
  const afterIn = el("input", { type: "date", cls: "mem-input", attrs: { "aria-label": "Загружено после" } });
  const extIn = el("input", { type: "text", cls: "mem-input", placeholder: "pdf, txt…", maxLength: 12, attrs: { "aria-label": "Расширение" } });
  const groupSel = el("select", { cls: "dk-select", attrs: { "aria-label": "Группировка" } },
    el("option", { value: "none", textContent: "Без групп" }), el("option", { value: "type", textContent: "По типу" }), el("option", { value: "date", textContent: "По месяцу" }));
  const filterCount = el("span", { cls: "dk-filter-n", hidden: true });
  const filters = el("details", { cls: "dk-filters" },
    el("summary", { cls: "btn sm" }, dIcon("filter", 16), "Фильтры", filterCount),
    el("div", { cls: "dk-filters-pop" },
      el("label", {}, el("span", { textContent: "Размер" }), el("div", { cls: "dk-pair" }, minIn, maxIn)),
      el("label", {}, el("span", { textContent: "Загружено после" }), afterIn),
      el("label", {}, el("span", { textContent: "Расширение" }), extIn),
      el("label", {}, el("span", { textContent: "Группировка" }), groupSel),
      btn("Сбросить", () => { minIn.value = maxIn.value = afterIn.value = extIn.value = ""; groupSel.value = "none"; readFilters(); }, { small: true })));
  const readFilters = () => {
    minKb = minIn.value === "" ? null : Number(minIn.value); maxKb = maxIn.value === "" ? null : Number(maxIn.value);
    after = afterIn.value; ext = extIn.value; groupBy = groupSel.value as GroupKey; limit = PAGE;
    const n = [minKb !== null, maxKb !== null, !!after, !!ext.trim(), groupBy !== "none"].filter(Boolean).length;
    filterCount.hidden = !n; filterCount.textContent = String(n);
    renderFiles();
  };
  for (const x of [minIn, maxIn, afterIn, extIn]) x.addEventListener("input", readFilters);
  groupSel.addEventListener("change", readFilters);
  const head = el("div", { cls: "dk-head" }, el("div", { cls: "dk-head-path" }, crumbs, countNote), el("div", { cls: "dk-head-tools" }, sortSel, filters, modeBox));

  /* ---------------------------------------------------------------- selection bar and trash bar */
  const selBar = el("div", { cls: "dk-selbar", hidden: true, attrs: { role: "toolbar", "aria-label": "Выбранные файлы" } });
  const trashBar = el("div", { cls: "dk-trashbar", hidden: true });
  const renderSelBar = () => {
    for (const id of [...selected]) if (!byId(id)) selected.delete(id);
    const n = selected.size;
    selBar.hidden = !n;
    for (const card of filesBox.querySelectorAll<HTMLElement>(".dk-file")) {
      const on = selected.has(card.dataset.id!);
      card.classList.toggle("picked", on);
      const box = card.querySelector<HTMLInputElement>("input"); if (box) box.checked = on;
    }
    if (!n) { selBar.replaceChildren(); return; }
    const ids = [...selected];
    const act = (ic: DiskIconName, label: string, run: () => void, danger = false) => {
      const b = el("button", { type: "button", cls: "dk-sel-btn" + (danger ? " danger" : ""), title: label }, dIcon(ic, 17), el("span", { textContent: label }));
      b.addEventListener("click", run); return b;
    };
    selBar.replaceChildren(
      el("strong", { textContent: "Выбрано: " + n }),
      ...(view === "trash"
        ? [act("restore", "Восстановить", () => void restoreFiles(ids)), act("sweep", "Удалить навсегда", () => void purgeFiles(ids), true)]
        : [
          act("copy", "Копировать", () => { clipboard = { ids, cut: false }; showToast("Скопировано: " + filesWord(ids.length) + ". Откройте папку и нажмите «Вставить» или Ctrl+V."); renderSelBar(); }),
          act("cut", "Вырезать", () => { clipboard = { ids, cut: true }; showToast("Вырезано: " + filesWord(ids.length) + ". Откройте папку и нажмите «Вставить» или Ctrl+V."); renderSelBar(); }),
          act("move", "Переместить", () => void moveFiles(ids)),
          act("star", ids.every((id) => byId(id)?.favorite) ? "Убрать из избранного" : "В избранное", () => void favoriteFiles(ids)),
          act("zipDown", "Скачать ZIP", () => void downloadZip({ ids })),
          ...(deps.attach && ids.some((id) => askable(byId(id)?.name ?? "")) ? [act("chatIn", "В беседу", () => void attachToChat(ids))] : []),
          act("trash", "В корзину", () => void trashFiles(ids), true),
        ]),
      ...(clipboard && view !== "trash" ? [act("paste", "Вставить", () => void paste())] : []),
      iconButton("x", "Снять выбор (Esc)", () => { selected.clear(); renderSelBar(); }, "icon-btn sm dk-sel-close"));
  };
  const keepSelect = el("select", { cls: "dk-select", attrs: { "aria-label": "Сколько хранить файлы в корзине" } },
    ...[[0, "не удалять сами"], [7, "через 7 дней"], [30, "через 30 дней"], [90, "через 90 дней"]].map(([v, t]) => el("option", { value: String(v), textContent: String(t) })));
  keepSelect.addEventListener("change", async () => {
    const r = await api.diskTrashDays(Number(keepSelect.value));
    if (!r.ok) { showToast(r.error.message); keepSelect.value = String(keepDays); return; }
    keepDays = r.value.days; renderFiles();
    showToast(keepDays ? "Файлы из корзины будут удаляться через " + plural(keepDays, "день", "дня", "дней") : "Корзина больше не очищается сама");
  });
  const renderTrashBar = () => {
    trashBar.hidden = view !== "trash";
    if (trashBar.hidden) return;
    keepSelect.value = String([0, 7, 30, 90].includes(keepDays) ? keepDays : 30);
    const empty = btn("Очистить корзину", () => void emptyTrash(), { small: true, danger: true, disabled: !trash.length });
    empty.prepend(dIcon("sweep", 16));
    trashBar.replaceChildren(el("span", { cls: "dk-trash-note" }, dIcon("info", 16), "Файлы удаляются навсегда"), keepSelect,
      el("span", { cls: "dk-grow" }), btn("Удалённые папки", () => void openDeletedFolders(), { small: true }), empty);
  };

  /* ---------------------------------------------------------------- files */
  const filesBox = el("div", { cls: "dk-files", attrs: { "aria-label": "Файлы" } });
  const dropzone = el("div", { cls: "dk-dropzone", attrs: { "aria-hidden": "true" } }, dIcon("upload", 34), el("strong"), el("span", { textContent: "До 500 МБ на файл, можно целые папки" }));
  const main = el("section", { cls: "dk-main" }, head, selBar, trashBar, filesBox, dropzone);
  const sourceList = () => view === "trash" ? trash
    : all.filter((f) => (view !== "favorites" || f.favorite) && matchesVirtual(f, virtual) && (view !== "all" || virtual !== "none" || everywhere || f.folder === current));
  const thumbFor = (f: DiskFile, size: number) => {
    const box = el("span", { cls: "dk-thumb" });
    if (f.color) box.style.setProperty("--tag", f.color);
    const picture = (src: string, made: boolean) => {
      box.classList.add("loading");
      if (made) box.classList.add("made", "kind-" + madeThumb(f));
      const img = el("img", { alt: "", loading: "lazy", decoding: "async", draggable: false });
      img.addEventListener("load", () => box.classList.remove("loading"), { once: true });
      img.addEventListener("error", () => { box.classList.remove("loading", "made"); img.replaceWith(fileBadge(f.name, size)); }, { once: true });
      img.src = src;
      return img;
    };
    if (view === "trash") box.append(fileBadge(f.name, size));
    else if (hasThumb(f)) box.append(picture(diskRawUrl(f), false));
    else if (madeThumb(f) && thumbReady(f)) box.append(picture(diskThumbUrl(f), true));
    else {
      const badge = fileBadge(f.name, size);
      box.append(badge);
      // PDFs and videos get a real picture: drawn once when the tile shows up, then kept by the server
      if (madeThumb(f)) wantThumb(box, f, (ok) => { if (ok && badge.isConnected) badge.replaceWith(picture(diskThumbUrl(f), true)); });
    }
    if (madeThumb(f) === "video" && view !== "trash") box.append(el("span", { cls: "dk-play", attrs: { "aria-hidden": "true" } }));
    return box;
  };
  const card = (f: DiskFile) => {
    const c = el("div", { cls: "dk-file", tabIndex: -1, attrs: { "data-id": f.id, "data-file-id": f.id, role: "listitem", "aria-label": f.name } });
    c.style.setProperty("--k", KIND_COLOR[kindOf(f.name)]);
    if (selected.has(f.id)) c.classList.add("picked");
    if (focusId === f.id) c.tabIndex = 0;
    c.draggable = view !== "trash";
    const meta = view === "trash"
      ? "Удалён " + fmtDate(f.deletedAt ?? f.uploadedAt) + ((d) => (d === null ? "" : " · сотрётся через " + plural(d, "день", "дня", "дней")))(daysLeft(f.deletedAt, keepDays))
      : human(f.size) + " · " + fmtDate(f.uploadedAt) + (view !== "all" || virtual !== "none" || everywhere ? " · " + (f.folder || "Корень") : "");
    c.append(
      el("label", { cls: "dk-check", title: "Выбрать" }, el("input", { type: "checkbox", checked: selected.has(f.id), attrs: { "aria-label": "Выбрать " + f.name } })),
      thumbFor(f, mode === "large" ? 56 : mode === "table" ? 26 : 40),
      el("div", { cls: "dk-meta" },
        el("strong", { cls: "dk-name", textContent: f.name, title: f.name + (f.tags?.length ? "\nМетки: " + f.tags.join(", ") : "") }),
        el("small", { textContent: meta }),
        ...(f.tags?.length && mode !== "table" ? [el("span", { cls: "dk-tags" }, ...f.tags.slice(0, 3).map((t) => el("i", { textContent: t })))] : [])),
      ...(f.favorite && view !== "trash" ? [el("span", { cls: "dk-fav", title: "В избранном" }, dIcon("star", 15))] : []),
      el("button", { type: "button", cls: "icon-btn sm dk-more", attrs: { "aria-label": "Действия: " + f.name, "aria-haspopup": "menu", "aria-expanded": "false" } }, dIcon("more", 18)));
    return c;
  };
  const skeleton = () => Array.from({ length: 8 }, () => el("div", { cls: "dk-file dk-skel", attrs: { "aria-hidden": "true" } }, el("span", { cls: "dk-thumb" }), el("div", { cls: "dk-meta" }, el("i"), el("i"))));
  const emptyView = () => {
    const filtered = !!(query.trim() || ext.trim() || minKb !== null || maxKb !== null || after);
    if (filtered) {
      const act = !everywhere && view === "all" && virtual === "none" ? btn("Искать во всех папках", () => everyChip.click(), { small: true, icon: "search" })
        : btn("Сбросить поиск и фильтры", () => { search.value = ""; query = ""; minIn.value = maxIn.value = afterIn.value = extIn.value = ""; readFilters(); }, { small: true });
      return emptyState("search", "Ничего не нашлось", "Попробуйте другое слово или уберите фильтры.", act);
    }
    if (view === "trash") return emptyState("trash", "Корзина пуста", keepDays ? "Удалённые файлы лежат здесь " + plural(keepDays, "день", "дня", "дней") + ", потом удаляются сами." : "Удалённые файлы лежат здесь, пока вы не очистите корзину.");
    if (view === "favorites") return emptyState("star", "Избранного пока нет", "Отмечайте важные файлы звёздочкой в меню «⋯», и они соберутся здесь.");
    if (virtual !== "none") return emptyState("search", "Здесь пусто", "Таких файлов на Диске пока нет.");
    const up = btn("Загрузить файлы", chooseFiles, { primary: true });
    up.prepend(dIcon("upload", 17));
    return emptyState("folder", current ? "В папке «" + folderName(current) + "» пусто" : "На Диске пока нет файлов", "Перетащите файлы или целую папку в это окно или нажмите «Загрузить». Можно сразу несколько.",
      el("div", { cls: "dk-empty-actions" }, up, btn("Загрузить папку", chooseFolder, {}), btn("Новая папка", () => void createFolder(uploadFolder()), { icon: "plus" })));
  };
  const renderFiles = () => {
    filesBox.className = "dk-files mode-" + mode;
    if (!loaded) { filesBox.replaceChildren(...skeleton()); return; }
    shown = filterFiles(sourceList(), { text: query, contentIds, ext, minKb, maxKb, after, sort });
    const total = sourceList().length;
    countNote.textContent = !total ? "" : shown.length === total ? filesWord(total) : shown.length + " из " + total;
    if (!shown.length) { filesBox.replaceChildren(emptyView()); renderSelBar(); return; }
    if (focusId && !shown.some((f) => f.id === focusId)) focusId = null;
    const visible = shown.slice(0, limit);
    const nodes: HTMLElement[] = [];
    let group = "";
    for (const f of visible) {
      if (groupBy !== "none") { const g = groupLabel(f, groupBy); if (g !== group) { group = g; nodes.push(el("h3", { cls: "dk-group", textContent: g })); } }
      nodes.push(card(f));
    }
    if (!focusId && nodes.length) { const first = nodes.find((n) => n.classList.contains("dk-file")); if (first) first.tabIndex = 0; }
    if (shown.length > visible.length) {
      const more = el("button", { type: "button", cls: "dk-more-files", textContent: "Показать ещё " + Math.min(PAGE, shown.length - visible.length) + " из " + (shown.length - visible.length) });
      more.addEventListener("click", () => { limit += PAGE; renderFiles(); });
      nodes.push(more);
    }
    filesBox.setAttribute("role", "list");
    filesBox.replaceChildren(...nodes);
    renderSelBar();
  };
  /** Several changes in one frame redraw once. */
  let redrawQueued = false;
  const scheduleRedraw = () => { if (redrawQueued) return; redrawQueued = true; requestAnimationFrame(() => { redrawQueued = false; redraw(); }); };
  const cardOf = (id: string) => filesBox.querySelector<HTMLElement>(`.dk-file[data-id="${CSS.escape(id)}"]`);
  const focusCard = (id: string) => {
    const c = cardOf(id); if (!c) return;
    for (const x of filesBox.querySelectorAll<HTMLElement>(".dk-file[tabindex='0']")) x.tabIndex = -1;
    c.tabIndex = 0; focusId = id; c.focus({ preventScroll: false });
  };
  /** Brings a file into view and flashes it (after «Показать»). */
  const reveal = (id: string) => requestAnimationFrame(() => {
    let i = shown.findIndex((f) => f.id === id);
    if (i >= limit) { limit = i + 1; renderFiles(); i = shown.findIndex((f) => f.id === id); }
    const c = cardOf(id); if (!c) return;
    c.scrollIntoView({ block: "center", behavior: "smooth" }); focusCard(id);
    c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash");
  });
  const pick = (id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, toggle = false) => {
    if (e.shiftKey && !anchorId) { anchorId = id; toggle = true; }
    if (e.shiftKey && anchorId && !toggle) {
      const a = shown.findIndex((f) => f.id === anchorId), b = shown.findIndex((f) => f.id === id);
      if (a >= 0 && b >= 0) for (const f of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(f.id);
    } else if (toggle || e.ctrlKey || e.metaKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); anchorId = id; }
    renderSelBar();
  };
  filesBox.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const c = t.closest<HTMLElement>(".dk-file"); if (!c || c.classList.contains("dk-skel")) return;
    const f = byId(c.dataset.id!); if (!f) return;
    if (t.closest(".dk-more")) { openMenu(t.closest<HTMLElement>(".dk-more")!, fileMenu(f), "Действия с файлом"); return; }
    if (t.closest(".dk-check")) { if (t instanceof HTMLInputElement) pick(f.id, e, true); return; }
    focusId = f.id;
    if (e.shiftKey || e.ctrlKey || e.metaKey || selected.size || view === "trash") { e.preventDefault(); pick(f.id, e, !e.shiftKey); return; }
    openViewer(f);
  });
  filesBox.addEventListener("contextmenu", (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".dk-file"); const f = c && byId(c.dataset.id!);
    if (!f) return;
    e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY }, fileMenu(f), "Действия с файлом");
  });
  filesBox.addEventListener("dragstart", (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".dk-file"); if (!c || !e.dataTransfer) return;
    const ids = selected.has(c.dataset.id!) ? [...selected] : [c.dataset.id!];
    e.dataTransfer.setData(DISK_DRAG, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copyMove";
    page.classList.add("dk-dragging");
  });
  filesBox.addEventListener("dragend", () => page.classList.remove("dk-dragging"));

  /* ---------------------------------------------------------------- file menu (built when opened) */
  const fileMenu = (f: DiskFile): MenuItem[] => view === "trash" ? [
    { icon: "restore", label: "Восстановить", run: () => void restoreFiles([f.id]) },
    { icon: "sweep", label: "Удалить навсегда", run: () => void purgeFiles([f.id]), danger: true },
  ] : [
    { icon: "eye", label: "Открыть", run: () => openViewer(f), hint: "Enter" },
    { icon: "info", label: "Сведения", run: () => openInfo(f.id) },
    ...(deps.ask && askable(f.name) ? [{ icon: "ask", label: "Спросить JUUNIBI о файле", run: () => askAbout(f) } as MenuItem] : []),
    ...(deps.attach && askable(f.name) ? [{ icon: "chatIn", label: "Прикрепить к беседе", run: () => void attachToChat([f.id]) } as MenuItem] : []),
    { icon: "download", label: "Скачать", run: () => download(f) },
    { icon: "attach", label: "Прикрепить к делу…", run: () => void attachToTask([f.id]) },
    "-",
    { icon: "star", label: f.favorite ? "Убрать из избранного" : "В избранное", run: () => void favoriteFiles([f.id]) },
    { icon: "rename", label: "Переименовать", run: () => void renameFile(f), hint: "F2" },
    { icon: "move", label: "Переместить…", run: () => void moveFiles([f.id]) },
    { icon: "copy", label: "Копировать в папку…", run: () => void copyFiles([f.id]) },
    { icon: "tag", label: "Метки и цвет", run: () => openInfo(f.id, true) },
    { icon: "versions", label: "Версии", run: () => openInfo(f.id) },
    "-",
    { icon: "trash", label: "В корзину", run: () => void trashFiles([f.id]), danger: true, hint: "Del" },
  ];

  /* ---------------------------------------------------------------- actions: change in place, toast with undo */
  const fail = (m: string) => { showToast(m); return false; };
  const replace = (next: DiskFile) => {
    all = all.filter((x) => x.id !== next.id); trash = trash.filter((x) => x.id !== next.id);
    if (next.deletedAt) trash = [next, ...trash]; else all = [next, ...all];
  };
  const leave = async (ids: string[]) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = ids.map(cardOf).filter((c): c is HTMLElement => !!c).slice(0, 24);
    await Promise.all(cards.map((c) => c.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(14px) scale(.97)" }], { duration: 170, easing: "ease-in", fill: "forwards" }).finished.catch(() => undefined)));
  };
  const download = (f: DiskFile) => {
    const a = el("a", { href: diskRawUrl(f, true), attrs: { download: f.name } });
    document.body.append(a); a.click(); a.remove();
  };
  async function trashFiles(ids: string[]) {
    const r = ids.length === 1 ? await api.diskDelete(ids[0]!) : await api.diskBulk(ids, "trash");
    if (!r.ok) return fail(r.error.message);
    await leave(ids);
    const now = new Date().toISOString();
    for (const id of ids) { const f = all.find((x) => x.id === id); if (f) replace({ ...f, deletedAt: now }); selected.delete(id); }
    if (infoId && ids.includes(infoId)) closeInfo();
    redraw();
    const first = byId(ids[0]!);
    showToast(ids.length === 1 && first ? "«" + first.name + "» в корзине" : "В корзине: " + filesWord(ids.length), { action: { label: "Отменить", run: () => void restoreFiles(ids, true) } });
    return true;
  }
  async function restoreFiles(ids: string[], quiet = false) {
    const r = ids.length === 1 ? await api.diskRestore(ids[0]!) : await api.diskBulk(ids, "restore");
    if (!r.ok) return fail(r.error.message);
    if (view === "trash") await leave(ids);
    for (const id of ids) {
      const f = trash.find((x) => x.id === id); if (!f) continue;
      const back = { ...f, folder: f.folder && !folders.includes(f.folder) ? "" : f.folder };
      delete back.deletedAt; replace(back); selected.delete(id);
    }
    redraw();
    if (!quiet) showToast("Восстановлено: " + filesWord(ids.length));
    return true;
  }
  async function purgeFiles(ids: string[]) {
    const names = ids.map((id) => byId(id)?.name ?? "");
    if (!(await askConfirm({ title: "Удалить навсегда?", text: ids.length === 1 ? "«" + names[0] + "» исчезнет с компьютера вместе со всеми версиями. Вернуть его будет нельзя." : filesWord(ids.length) + " исчезнут с компьютера вместе с версиями. Вернуть их будет нельзя.", ok: "Удалить навсегда", danger: true }))) return false;
    for (const id of ids) { const r = await api.diskPurge(id); if (!r.ok) { redraw(); return fail(r.error.message); } trash = trash.filter((x) => x.id !== id); selected.delete(id); }
    void loadCatalog(false);
    showToast("Удалено навсегда: " + filesWord(ids.length));
    return true;
  }
  async function emptyTrash() {
    if (!trash.length) return;
    if (!(await askConfirm({ title: "Очистить корзину?", text: filesWord(trash.length) + " (" + human(trash.reduce((n, f) => n + f.size, 0)) + ") исчезнут с компьютера вместе с версиями. Вернуть их будет нельзя.", ok: "Очистить", danger: true }))) return;
    const r = await api.diskEmptyTrash();
    if (!r.ok) { showToast(r.error.message); return; }
    trash = []; selected.clear();
    void loadCatalog(false);
    showToast("Корзина очищена: " + filesWord(r.value.purged) + ", освобождено " + human(r.value.bytes));
  }
  async function favoriteFiles(ids: string[]) {
    const on = !ids.every((id) => byId(id)?.favorite);
    const r = ids.length === 1 ? await api.diskFavorite(ids[0]!, on) : await api.diskBulk(ids, on ? "favorite" : "unfavorite");
    if (!r.ok) return fail(r.error.message);
    for (const id of ids) { const f = all.find((x) => x.id === id); if (f) replace({ ...f, favorite: on }); }
    redraw();
    if (ids.length > 1) showToast((on ? "В избранном: " : "Убрано из избранного: ") + filesWord(ids.length));
    return true;
  }
  async function moveFiles(ids: string[], dest?: string) {
    const before = ids.map((id) => all.find((x) => x.id === id)).filter((f): f is DiskFile => !!f);
    if (!before.length) return false;
    const target = dest ?? await pickFolder({ folders, title: ids.length === 1 ? "Переместить «" + before[0]!.name + "»" : "Переместить " + filesWord(ids.length), ok: "Переместить сюда", start: before[0]!.folder });
    if (target === null) return false;
    if (before.every((f) => f.folder === target)) { showToast("Файлы уже в этой папке"); return false; }
    const r = ids.length === 1 ? await api.diskMove(ids[0]!, target) : await api.diskBulk(ids, "move", target);
    if (!r.ok) return fail(r.error.message);
    if (view === "all" && virtual === "none" && !everywhere) await leave(ids);
    for (const f of before) replace({ ...f, folder: target });
    redraw();
    showToast((ids.length === 1 ? "«" + before[0]!.name + "»" : filesWord(ids.length)) + " → " + (target || "Корень Диска"), {
      actions: [
        { label: "Отменить", run: () => void (async () => {
          for (const [folder, list] of moveBack(before)) {
            const u = list.length === 1 ? await api.diskMove(list[0]!, folder) : await api.diskBulk(list, "move", folder);
            // the server is the truth after a partial undo
            if (!u.ok) { showToast(u.error.message); await loadCatalog(false); return; }
            for (const id of list) { const f = before.find((x) => x.id === id); if (f) replace(f); }
          }
          redraw();
        })() },
        { label: "Открыть папку", run: () => go({ folder: target }) },
      ],
    });
    return true;
  }
  async function copyFiles(ids: string[], dest?: string) {
    const target = dest ?? await pickFolder({ folders, title: "Копировать в папку", ok: "Копировать сюда", start: current });
    if (target === null) return false;
    for (const id of ids) {
      const r = await api.diskCopy(id, target);
      if (!r.ok) { redraw(); return fail(r.error.message); }
      all = [r.value, ...all]; used += r.value.size;
    }
    redraw();
    showToast("Скопировано: " + filesWord(ids.length) + " → " + (target || "Корень Диска"), { action: { label: "Открыть папку", run: () => go({ folder: target }) } });
    return true;
  }
  async function paste() {
    if (!clipboard) return;
    const { ids, cut } = clipboard;
    const target = uploadFolder();
    const ok = cut ? await moveFiles(ids, target) : await copyFiles(ids, target);
    if (ok && cut) clipboard = null;
    renderSelBar();
  }
  async function renameFile(f: DiskFile) {
    const name = await askText({ title: "Переименовать", label: "Новое название", value: f.name, ok: "Сохранить", icon: "edit", keepExt: true });
    if (name === null || name === f.name) return;
    const r = await api.diskRename(f.id, name);
    if (!r.ok) { showToast(r.error.message); return; }
    replace(r.value); redraw();
    if (infoId === f.id) openInfo(f.id);
    showToast("Переименовано: «" + r.value.name + "»", { action: { label: "Отменить", run: () => void (async () => { const u = await api.diskRename(f.id, f.name); if (!u.ok) showToast(u.error.message); else { replace(u.value); redraw(); } })() } });
  }
  async function undoLast() {
    const r = await api.diskUndo();
    if (!r.ok) { showToast(r.error.message); return; }
    replace(r.value); redraw();
    showToast("Отменено: «" + r.value.name + "» снова в папке «" + (r.value.folder || "Корень") + "»");
  }

  /** «Скачать ZIP»: the server packs the files on the fly; the browser downloads it like any file. */
  async function downloadZip(req: { ids: string[] } | { folder: string }) {
    const r = await api.diskZip(req);
    if (!r.ok) { showToast(r.error.message); return; }
    const a = el("a", { href: r.value.url, attrs: { download: r.value.name } });
    document.body.append(a); a.click(); a.remove();
    showToast("Скачивается «" + r.value.name + "»: " + filesWord(r.value.files) + ", " + human(r.value.bytes));
  }
  /** «В беседу»: the text of up to 5 files goes to the chat composer, ready for a question. */
  async function attachToChat(ids: string[]) {
    if (!deps.attach) return;
    const picked = ids.map(byId).filter((f): f is DiskFile => !!f && askable(f.name)).slice(0, 5);
    if (!picked.length) { showToast("JUUNIBI читает текстовые файлы, PDF, Word, Excel и PowerPoint"); return; }
    showToast(picked.length === 1 ? "Читаю «" + picked[0]!.name + "»…" : "Читаю файлы: " + picked.length + "…");
    const out: { name: string; size: number; text: string }[] = [], failed: string[] = [];
    for (const f of picked) {
      const r = await api.diskText(f.id);
      if (!r.ok) { failed.push(f.name + ": " + r.error.message); continue; }
      // the chat takes up to 100 КБ a file: Cyrillic is two bytes a letter
      const text = r.value.text.length > 45000 ? r.value.text.slice(0, 45000) + "\n\n[… дальше файл обрезан]" : r.value.text;
      out.push({ name: /\.(txt|md|csv|json|log)$/i.test(f.name) ? f.name : f.name.replace(/\.[^.]+$/, "") + ".txt", size: new Blob([text]).size, text });
    }
    if (!out.length) { showToast(failed.join("; ")); return; }
    const why = deps.attach(out);
    showToast(why ?? ("В беседе: " + filesWord(out.length) + ". Напишите вопрос." + (failed.length ? " Не прочитались: " + failed.join("; ") : "")));
  }
  /** «Прикрепить к делу»: the file shows up on a to-do or a project in «Дела», and the to-do opens it in one click. */
  async function attachToTask(ids: string[]) {
    const files = ids.map(byId).filter((f): f is DiskFile => !!f);
    if (!files.length) return;
    const org = await api.organizer();
    if (!org.ok) { showToast(org.error.message); return; }
    const target = await pickTask({ notes: org.value.notes, projects: org.value.projects ?? [], title: files.length === 1 ? "Прикрепить «" + files[0]!.name + "»" : "Прикрепить " + filesWord(files.length) });
    if (!target) return;
    const add = files.map((f) => ({ id: f.id, name: f.name }));
    const merge = (cur: { id: string; name: string }[] = []) => [...cur.filter((x) => !add.some((a) => a.id === x.id)), ...add].slice(-20);
    if (target.kind === "task") {
      const n = org.value.notes.find((x) => x.id === target.id);
      const r = await api.updateTask(target.id, { files: merge(n?.files) });
      if (!r.ok) { showToast(r.error.message); return; }
      showToast("Прикреплено к делу «" + r.value.text.slice(0, 60) + "»", { action: { label: "Открыть дела", run: () => { location.hash = "#/tasks"; } } });
    } else {
      const p = (org.value.projects ?? []).find((x) => x.name.toLowerCase() === target.name.toLowerCase());
      const r = await api.setProject(target.name, { files: merge(p?.files) });
      if (!r.ok) { showToast(r.error.message); return; }
      showToast("Прикреплено к проекту «" + target.name + "»", { action: { label: "Открыть дела", run: () => { location.hash = "#/tasks"; } } });
    }
    if (infoId && ids.includes(infoId)) openInfo(infoId);
  }

  /* ---------------------------------------------------------------- folders */
  async function createFolder(parent: string) {
    const name = await askText({ title: parent ? "Новая папка в «" + folderName(parent) + "»" : "Новая папка", label: "Название папки", ok: "Создать", icon: "folder" });
    if (!name) return;
    const r = await api.diskFolder(parent ? parent + "/" + name : name);
    if (!r.ok) { showToast(r.error.message); return; }
    if (parent) expanded.add(parent);
    await loadCatalog();
    go({ folder: r.value.name });
  }
  const folderMenu = (folder: string): MenuItem[] => [
    { icon: "folderPlus", label: "Новая подпапка", run: () => void createFolder(folder) },
    { icon: "rename", label: "Переименовать", run: () => void (async () => {
      const name = await askText({ title: "Переименовать папку", label: "Новое название", value: folderName(folder), ok: "Сохранить", icon: "folder" });
      if (!name || name === folderName(folder)) return;
      const next = (parentOf(folder) ? parentOf(folder) + "/" : "") + name;
      const r = await api.diskRenameFolder(folder, next);
      if (!r.ok) { showToast(r.error.message); return; }
      if (current === folder || current.startsWith(folder + "/")) current = next + current.slice(folder.length);
      void loadCatalog();
    })() },
    { icon: "move", label: "Переместить папку", run: () => void (async () => {
      const dest = await pickFolder({ folders, title: "Переместить папку «" + folderName(folder) + "»", ok: "Переместить сюда", start: parentOf(folder), moving: folder });
      if (dest === null || dest === parentOf(folder)) return;
      const r = await api.diskFolderMove(folder, dest);
      if (!r.ok) { showToast(r.error.message); return; }
      if (current === folder || current.startsWith(folder + "/")) current = r.value.name + current.slice(folder.length);
      if (dest) expanded.add(dest);
      void loadCatalog();
      showToast("Папка перемещена в «" + (dest || "Корень Диска") + "»");
    })() },
    { icon: "copy", label: "Копировать папку", run: () => void (async () => {
      const r = await api.diskFolderCopy(folder, parentOf(folder));
      if (!r.ok) { showToast(r.error.message); return; }
      void loadCatalog();
      showToast("Создана копия «" + folderName(r.value.name) + "»: " + filesWord(r.value.files));
    })() },
    { icon: "folderUp", label: "Загрузить сюда папку…", run: () => { go({ folder }); chooseFolder(); } },
    { icon: "zipDown", label: "Скачать ZIP-архивом", run: () => void downloadZip({ folder }) },
    { icon: "refresh", label: "Синхронизировать в…", run: () => void syncFolder(folder) },
    { icon: "palette", label: "Цвет и обложка", run: () => folderLook(folder) },
    "-",
    { icon: "trash", label: "Удалить папку", danger: true, run: () => void (async () => {
      const n = folderTotals(all).get(folder)?.count ?? 0;
      if (!(await askConfirm({ title: "Удалить папку «" + folderName(folder) + "»?", text: "Папка, её подпапки и " + filesWord(n) + " уйдут в корзину. Вернуть их можно в «Корзина → Удалённые папки».", ok: "В корзину", danger: true }))) return;
      const r = await api.diskFolderTrash(folder);
      if (!r.ok) { showToast(r.error.message); return; }
      if (current === folder || current.startsWith(folder + "/")) current = parentOf(folder);
      void loadCatalog();
      showToast("Папка «" + folderName(folder) + "» в корзине", { action: { label: "Отменить", run: () => void api.diskFolderRestore(folder).then((x) => { if (!x.ok) showToast(x.error.message); void loadCatalog(); }) } });
    })() },
  ];
  async function syncFolder(folder: string) {
    const dest = await pickFolder({ folders, title: "Синхронизировать «" + folderName(folder) + "» в…", ok: "Проверить", start: parentOf(folder), moving: folder });
    if (dest === null) return;
    const plan = await api.diskFolderSync(folder, dest, false);
    if (!plan.ok) { showToast(plan.error.message); return; }
    const p = plan.value;
    if (p.conflicts.length) { showToast("Есть конфликты: " + p.conflicts.map((c) => c.name + " (" + c.reason + ")").join("; "), { ms: 12000 }); return; }
    if (!p.pending) { showToast("Синхронизация не нужна: всё уже на месте"); return; }
    if (!(await askConfirm({ title: "Синхронизировать?", text: "В «" + (dest || "Корень Диска") + "» скопируется " + filesWord(p.pending) + ", одинаковых уже " + p.unchanged + ". Существующие файлы не перезаписываются.", ok: "Синхронизировать", icon: "refresh" }))) return;
    const r = await api.diskFolderSync(folder, dest, true);
    if (!r.ok) { showToast(r.error.message); return; }
    void loadCatalog();
    showToast("Синхронизировано: " + filesWord(r.value.copied));
  }
  function folderLook(folder: string) {
    const st = styles[folder] ?? { color: "", pinned: false, cover: "" };
    const COLORS = ["", "#d9a441", "#e0443a", "#e27a2c", "#1b9a52", "#1f9d8f", "#2f6fdf", "#7c5cf0", "#d9468b"];
    let color = st.color;
    const swatches = el("div", { cls: "dk-swatches", attrs: { role: "radiogroup", "aria-label": "Цвет папки" } });
    const drawSw = () => swatches.replaceChildren(...COLORS.map((c) => {
      const b = el("button", { type: "button", cls: "dk-swatch" + (c === color ? " on" : ""), title: c ? c : "Без цвета", attrs: { role: "radio", "aria-checked": String(c === color), "aria-label": c || "Без цвета" } });
      b.style.setProperty("--sw", c || "transparent");
      b.addEventListener("click", () => { color = c; drawSw(); });
      return b;
    }));
    drawSw();
    const pin = el("input", { type: "checkbox", checked: st.pinned });
    const covers = all.filter((f) => f.folder === folder && hasThumb(f));
    const cover = el("select", { cls: "dk-select", attrs: { "aria-label": "Обложка" } }, el("option", { value: "", textContent: "Без обложки" }), ...covers.map((f) => el("option", { value: f.id, textContent: f.name })));
    cover.value = st.cover;
    const body = el("div", { cls: "dk-form" },
      el("span", { cls: "dk-form-label", textContent: "Цвет" }), swatches,
      el("label", { cls: "dk-check-line" }, pin, " Закрепить наверху"),
      el("span", { cls: "dk-form-label", textContent: "Обложка" }), covers.length ? cover : el("small", { cls: "muted", textContent: "В папке нет картинок для обложки." }),
      el("div", { cls: "dk-form-actions" }, btn("Отмена", () => sheet.close()), btn("Сохранить", async () => {
        const r = await api.diskFolderStyle(folder, color || "#b89cff", pin.checked, covers.length ? cover.value : "");
        if (!r.ok) { showToast(r.error.message); return; }
        styles[folder] = { ...st, color, pinned: pin.checked, cover: covers.length ? cover.value : "" };
        sheet.close(); renderTree();
      }, { primary: true })));
    const sheet = openSheet({ title: "Оформление «" + folderName(folder) + "»", icon: "palette", content: body });
    body.closest(".mod-sheet")?.classList.add("dk-small-sheet");
  }

  /* ---------------------------------------------------------------- tree */
  const tree = el("div", { cls: "dk-tree", attrs: { role: "tree", "aria-label": "Папки" } });
  const treeFind = el("input", { type: "search", cls: "dk-tree-find", placeholder: "Найти папку", attrs: { "aria-label": "Найти папку" } });
  treeFind.addEventListener("input", () => { treeQuery = treeFind.value.trim().toLocaleLowerCase(); renderTree(); });
  const treeSortSel = el("select", { cls: "dk-select dk-tree-sort", attrs: { "aria-label": "Порядок папок" } },
    ...([["pinned", "Закреплённые"], ["name", "По имени"], ["files", "По числу файлов"], ["size", "По размеру"], ["created", "Новые сверху"]] as const).map(([v, t]) => el("option", { value: v, textContent: t })));
  treeSortSel.addEventListener("change", () => { treeSort = treeSortSel.value as typeof treeSort; renderTree(); });
  const treeCount = el("small", { cls: "muted" });
  const sections = el("div", { cls: "dk-sections", attrs: { role: "list", "aria-label": "Разделы" } });
  const side = el("aside", { cls: "dk-side", attrs: { "aria-label": "Папки и разделы" } },
    el("div", { cls: "dk-side-head" }, el("strong", { textContent: "Папки" }), treeCount, iconButton("x", "Закрыть", () => setDrawer(false), "icon-btn sm dk-side-close")),
    el("div", { cls: "dk-side-tools" }, treeFind, treeSortSel), tree,
    el("div", { cls: "dk-side-sep", textContent: "Разделы" }), sections);
  const scrim = el("div", { cls: "dk-scrim" });
  const setDrawer = (open: boolean) => { page.classList.toggle("drawer-open", open); if (open) side.querySelector<HTMLElement>(".dk-node.current .dk-node-label, .dk-side-close")?.focus({ preventScroll: true }); };
  drawerBtn.addEventListener("click", () => setDrawer(true));
  scrim.addEventListener("click", () => setDrawer(false));
  const saveOpen = () => store.set("juunibi.disk.open", JSON.stringify([...expanded]));
  const dropFiles = (target: HTMLElement, folder: string) => {
    target.addEventListener("dragover", (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (types.includes("application/x-juunibi-files") || types.includes("application/x-juunibi-folder")) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; target.classList.add("drop"); }
    });
    target.addEventListener("dragleave", () => target.classList.remove("drop"));
    target.addEventListener("drop", (e) => {
      target.classList.remove("drop"); page.classList.remove("dk-dragging");
      const moving = e.dataTransfer?.getData("application/x-juunibi-folder");
      const ids = e.dataTransfer?.getData("application/x-juunibi-files");
      if (!moving && !ids) return;
      e.preventDefault(); e.stopPropagation();
      if (folder === TRASH_DROP) { if (ids) void trashFiles(JSON.parse(ids) as string[]); else if (moving) showToast("Папку удаляют из её меню «⋯»"); return; }
      if (moving) {
        if (moving === folder || folder.startsWith(moving + "/") || parentOf(moving) === folder) return;
        void api.diskFolderMove(moving, folder).then((r) => { if (!r.ok) showToast(r.error.message); else { if (current === moving || current.startsWith(moving + "/")) current = r.value.name + current.slice(moving.length); void loadCatalog(); } });
      } else void moveFiles(JSON.parse(ids!) as string[], folder);
    });
  };
  const renderTree = () => {
    const totals = folderTotals(all);
    const kids = folderChildren(folders);
    const order = (a: string, b: string) => {
      const ta = totals.get(a), tb = totals.get(b);
      if (treeSort === "files") return (tb?.count ?? 0) - (ta?.count ?? 0);
      if (treeSort === "size") return (tb?.bytes ?? 0) - (ta?.bytes ?? 0);
      if (treeSort === "created") return (styles[b]?.createdAt ?? "").localeCompare(styles[a]?.createdAt ?? "");
      if (treeSort === "pinned") return Number(!!styles[b]?.pinned) - Number(!!styles[a]?.pinned) || a.localeCompare(b, "ru", { numeric: true });
      return a.localeCompare(b, "ru", { numeric: true });
    };
    const matches = (f: string) => !treeQuery || f.toLocaleLowerCase().includes(treeQuery) || folders.some((x) => x.startsWith(f + "/") && x.toLocaleLowerCase().includes(treeQuery));
    const node = (folder: string, depth: number): HTMLElement | null => {
      if (folder && !matches(folder)) return null;
      const children = (kids.get(folder) ?? []).sort(order);
      const open = !folder || expanded.has(folder) || !!treeQuery;
      const isCur = view === "all" && virtual === "none" && current === folder;
      const t = totals.get(folder);
      const st = styles[folder];
      const row = el("div", { cls: "dk-node" + (isCur ? " current" : ""), attrs: { role: "treeitem", "aria-level": String(depth + 1) } });
      if (children.length && folder) row.setAttribute("aria-expanded", String(open));
      row.style.setProperty("--depth", String(depth));
      const toggle = el("button", { type: "button", cls: "dk-node-toggle", tabIndex: -1, attrs: { "aria-label": open ? "Свернуть" : "Развернуть" } }, children.length && folder ? dIcon("chevronRight", 14) : null);
      if (open) toggle.classList.add("open");
      toggle.disabled = !children.length || !folder;
      toggle.addEventListener("click", () => { if (expanded.has(folder)) expanded.delete(folder); else expanded.add(folder); saveOpen(); renderTree(); });
      const label = el("button", { type: "button", cls: "dk-node-label disk-tree-select", attrs: { "aria-current": isCur ? "page" : "false", title: folder || "Корень Диска" } },
        st?.cover && all.some((f) => f.id === st.cover) ? el("img", { cls: "dk-cover", alt: "", loading: "lazy", src: diskRawUrl(all.find((f) => f.id === st.cover)!) })
          : el("span", { cls: "dk-node-ic" }, folder ? dIcon(isCur ? "folderOpen" : "folder", 17) : dIcon("disk", 17)),
        el("span", { cls: "dk-node-name", textContent: folder ? folderName(folder) : "Диск" }),
        st?.pinned ? el("span", { cls: "dk-pin", title: "Закреплена" }, dIcon("pin", 12)) : null,
        el("small", { cls: "dk-node-n", textContent: t ? t.count + " · " + human(t.bytes) : "пусто" }));
      if (st?.color && st.color !== "#b89cff") label.style.setProperty("--fc", st.color);
      label.addEventListener("click", () => { go({ folder }); setDrawer(false); });
      label.addEventListener("keydown", (e) => {
        const all2 = [...tree.querySelectorAll<HTMLButtonElement>(".dk-node-label")];
        const i = all2.indexOf(label);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); all2[Math.max(0, Math.min(all2.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus(); }
        if (e.key === "ArrowRight" && children.length && folder && !expanded.has(folder)) { e.preventDefault(); expanded.add(folder); saveOpen(); renderTree(); tree.querySelectorAll<HTMLButtonElement>(".dk-node-label")[i]?.focus(); }
        if (e.key === "ArrowLeft" && folder && expanded.has(folder)) { e.preventDefault(); expanded.delete(folder); saveOpen(); renderTree(); tree.querySelectorAll<HTMLButtonElement>(".dk-node-label")[i]?.focus(); }
        if (e.key === "F2" && folder) { e.preventDefault(); (folderMenu(folder)[1] as Exclude<MenuItem, "-">).run(); }
      });
      if (folder) {
        label.draggable = true;
        label.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("application/x-juunibi-folder", folder); page.classList.add("dk-dragging"); });
        label.addEventListener("dragend", () => page.classList.remove("dk-dragging"));
      }
      const more = el("button", { type: "button", cls: "icon-btn sm dk-node-more disk-folder-menu", attrs: { "aria-label": "Действия с папкой " + (folder ? folderName(folder) : ""), "aria-haspopup": "menu", "aria-expanded": "false" } }, dIcon("more", 16));
      more.addEventListener("click", () => openMenu(more, folderMenu(folder), "Действия с папкой"));
      row.append(toggle, label, ...(folder ? [more] : []));
      dropFiles(row, folder);
      const wrap = el("div", { cls: "dk-branch" }, row);
      if (open && children.length) {
        const sub = el("div", { cls: "dk-branch-kids", attrs: { role: "group" } });
        for (const c of children) { const n = node(c, depth + 1); if (n) sub.append(n); }
        wrap.append(sub);
      }
      return wrap;
    };
    treeCount.textContent = plural(folders.length, "папка", "папки", "папок");
    tree.replaceChildren(node("", 0) ?? el("span"));
    const counts: Record<string, number> = {
      favorites: all.filter((f) => f.favorite).length, trash: trash.length,
      recent: all.filter((f) => matchesVirtual(f, "recent")).length, images: all.filter((f) => matchesVirtual(f, "images")).length,
      documents: all.filter((f) => matchesVirtual(f, "documents")).length, large: all.filter((f) => matchesVirtual(f, "large")).length,
    };
    sections.replaceChildren(...SECTIONS.map((s) => {
      const on = s.id === "favorites" || s.id === "trash" ? view === s.id : view === "all" && virtual === s.id;
      const b = el("button", { type: "button", cls: "dk-section" + (on ? " current" : ""), attrs: { role: "listitem", "aria-current": on ? "page" : "false" } },
        el("span", { cls: "dk-node-ic" }, dIcon(s.icon, 17)), el("span", { cls: "dk-node-name", textContent: s.label }), el("small", { cls: "dk-node-n", textContent: String(counts[s.id] ?? "") }));
      b.addEventListener("click", () => { go(s.id === "favorites" || s.id === "trash" ? { view: s.id } : { virtual: s.id }); setDrawer(false); });
      if (s.id === "trash") dropFiles(b, TRASH_DROP);
      return b;
    }));
  };

  /* ---------------------------------------------------------------- «Сведения» side panel */
  const info = el("aside", { cls: "dk-info", hidden: true, attrs: { "aria-label": "Сведения о файле" } });
  const closeInfo = () => { infoId = null; info.hidden = true; layout.classList.remove("with-info"); };
  function openInfo(id: string, focusTags = false) {
    const f = byId(id); if (!f) return;
    infoId = id;
    const kindTitle = kindOf(f.name);
    const big = el("div", { cls: "dk-info-pic" + (hasThumb(f) ? "" : " badge") }, hasThumb(f) ? el("img", { src: diskRawUrl(f), alt: f.name, loading: "lazy" }) : fileBadge(f.name, 84));
    big.style.setProperty("--k", KIND_COLOR[kindTitle]);
    const row = (label: string, value: Node | string) => el("div", { cls: "dk-info-row" }, el("span", { textContent: label }), typeof value === "string" ? el("b", { textContent: value }) : value);
    const folderLink = el("button", { type: "button", cls: "dk-link", textContent: f.folder || "Корень Диска" });
    folderLink.addEventListener("click", () => { go({ folder: f.folder }); reveal(f.id); });
    const tags = el("input", { type: "text", cls: "mem-input", value: (f.tags ?? []).join(", "), placeholder: "отпуск, документы", attrs: { "aria-label": "Метки через запятую" } });
    const note = el("textarea", { cls: "mem-input", value: f.note ?? "", rows: 3, placeholder: "Пара слов о файле", attrs: { "aria-label": "Описание" } });
    let color = f.color ?? "";
    const COLORS = ["", "#e0443a", "#e27a2c", "#d9a441", "#1b9a52", "#2f6fdf", "#7c5cf0", "#d9468b"];
    const sw = el("div", { cls: "dk-swatches", attrs: { role: "radiogroup", "aria-label": "Цвет метки" } });
    const drawSw = () => sw.replaceChildren(...COLORS.map((c) => {
      const b = el("button", { type: "button", cls: "dk-swatch" + (c === color ? " on" : ""), attrs: { role: "radio", "aria-checked": String(c === color), "aria-label": c || "Без цвета" } });
      b.style.setProperty("--sw", c || "transparent");
      b.addEventListener("click", () => { color = c; drawSw(); });
      return b;
    }));
    drawSw();
    const saveMeta = btn("Сохранить", async () => {
      const r = await api.diskMetadata(f.id, tags.value.split(",").map((x) => x.trim()).filter(Boolean), color, note.value);
      if (!r.ok) { showToast(r.error.message); return; }
      replace(r.value); renderFiles(); showToast("Сведения сохранены");
    }, { small: true, primary: true });
    const versions = el("div", { cls: "dk-versions" }, el("small", { cls: "muted", textContent: "Загрузка версий…" }));
    const newVersion = el("input", { type: "file", hidden: true });
    newVersion.addEventListener("change", async () => {
      const file = newVersion.files?.[0]; newVersion.value = "";
      if (!file) return;
      if (!file.size || file.size > maxBytes) { showToast("Новая версия: от 1 байта до " + human(maxBytes)); return; }
      const res = await fetch("/api/disk/files/" + encodeURIComponent(f.id) + "/versions/binary?expected=" + encodeURIComponent(f.sha256), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
      const body = (await res.json().catch(() => ({}))) as DiskFile & { error?: string };
      if (!res.ok) { showToast(body.error ?? "Не удалось сохранить версию"); return; }
      replace(body); used += body.size; redraw(); openInfo(f.id); showToast("Сохранена новая версия «" + f.name + "»");
    });
    void api.diskVersions(f.id).then((r) => {
      if (!r.ok || infoId !== f.id) return;
      const list = r.value.versions.slice().reverse();
      versions.replaceChildren(...list.map((v) => el("div", { cls: "dk-version" },
        el("span", {}, el("b", { textContent: "Версия " + v.revision }), el("small", { cls: "muted", textContent: human(v.size) + " · " + fmtTime(v.at) })),
        v.revision === (f.revision ?? 1) ? el("small", { cls: "dk-version-now", textContent: "текущая" })
          : btn("Вернуть", async () => {
            if (!(await askConfirm({ title: "Вернуть версию " + v.revision + "?", text: "Текущая версия «" + f.name + "» останется в истории.", ok: "Вернуть", icon: "undo" }))) return;
            const x = await api.diskRestoreVersion(f.id, v.revision);
            if (!x.ok) { showToast(x.error.message); return; }
            replace(x.value); redraw(); openInfo(f.id); void loadCatalog(false); showToast("Возвращена версия " + v.revision);
          }, { small: true }))),
        btn("Загрузить новую версию", () => newVersion.click(), { small: true, icon: "plus" }), newVersion);
    });
    const actions = el("div", { cls: "dk-info-actions" },
      ...(previewKind(f.name) && !f.deletedAt ? [btn("Открыть", () => openViewer(f), { small: true, icon: "eye" })] : []),
      ...(!f.deletedAt ? [btn("Скачать", () => download(f), { small: true, icon: "download" })] : []),
      ...(deps.ask && askable(f.name) && !f.deletedAt ? [btn("Спросить JUUNIBI", () => askAbout(f), { small: true, icon: "sparkle" })] : []));
    // «В делах»: to-dos and projects this file is attached to
    const linked = el("section", { cls: "dk-info-block dk-linked", hidden: true });
    if (!f.deletedAt) void api.organizer().then((r) => {
      if (!r.ok || infoId !== f.id) return;
      const tasks = r.value.notes.filter((n) => n.files?.some((x) => x.id === f.id));
      const projs = (r.value.projects ?? []).filter((p) => p.files?.some((x) => x.id === f.id));
      const detach = async (kind: "task" | "project", key: string, cur: { id: string; name: string }[]) => {
        const rest = cur.filter((x) => x.id !== f.id);
        const u = kind === "task" ? await api.updateTask(key, { files: rest.length ? rest : null }) : await api.setProject(key, { files: rest.length ? rest : null });
        if (!u.ok) { showToast(u.error.message); return; }
        showToast("Файл откреплён"); openInfo(f.id);
      };
      const row = (ic: DiskIconName, label: string, done: boolean, run: () => void) => el("div", { cls: "dk-linked-row" + (done ? " done" : "") }, dIcon(ic, 16),
        el("span", { cls: "dk-linked-text", textContent: label }), iconButton("x", "Открепить", run, "icon-btn sm"));
      linked.replaceChildren(el("h4", { textContent: "В делах" }),
        ...tasks.map((n: Note) => row("check", n.text, n.done, () => void detach("task", n.id, n.files ?? []))),
        ...projs.map((p) => row("folder", "#" + p.name, false, () => void detach("project", p.name, p.files ?? []))),
        btn("Прикрепить к делу", () => void attachToTask([f.id]), { small: true, icon: "plus" }));
      linked.hidden = false;
    });
    info.replaceChildren(
      el("header", { cls: "dk-info-head" }, el("strong", { textContent: "Сведения" }), iconButton("x", "Закрыть сведения", closeInfo, "icon-btn sm")),
      big, el("h3", { cls: "dk-info-name", textContent: f.name }), actions,
      el("div", { cls: "dk-info-rows" }, row("Папка", folderLink), row("Размер", human(f.size)), row("Загружен", fmtTime(f.uploadedAt)), row("Тип", f.name.split(".").pop()?.toUpperCase() ?? "—"),
        row("Контрольная сумма", el("code", { textContent: f.sha256.slice(0, 16) + "…", title: "SHA-256: " + f.sha256 }))),
      ...(!f.deletedAt ? [
        el("section", { cls: "dk-info-block" }, el("h4", { textContent: "Метки и цвет" }), tags, sw, note, saveMeta),
        el("section", { cls: "dk-info-block" }, el("h4", { textContent: "Версии" }), versions),
        linked,
      ] : []));
    info.hidden = false;
    layout.classList.add("with-info");
    if (focusTags) requestAnimationFrame(() => tags.focus());
  }

  /* ---------------------------------------------------------------- viewer: ← → between files, zoom, download */
  function openViewer(f: DiskFile) {
    const list = shown.length ? shown : [f];
    let index = Math.max(0, list.findIndex((x) => x.id === f.id));
    let zoom = 1;
    const stage = el("div", { cls: "dk-view-stage" });
    const title = el("strong", { cls: "dk-view-name" });
    const counter = el("small", { cls: "dk-view-count" });
    const zoomOut = ib("zoomOut", "Уменьшить (−)", () => setZoom(zoom / 1.5));
    const zoomIn = ib("zoomIn", "Увеличить (+)", () => setZoom(zoom * 1.5));
    const dl = ib("download", "Скачать", () => download(list[index]!));
    const infoB = ib("info", "Сведения", () => { const id = list[index]!.id; close(); openInfo(id); });
    const askB = ib("ask", "Спросить JUUNIBI о файле", () => { const x = list[index]!; close(); askAbout(x); });
    let rawMd = store.get("juunibi.disk.mdRaw") === "1";
    const mdB = ib("markdown", "Оформление или исходный текст", () => { rawMd = !rawMd; store.set("juunibi.disk.mdRaw", rawMd ? "1" : ""); show(); });
    const prev = el("button", { type: "button", cls: "dk-view-nav prev", attrs: { "aria-label": "Предыдущий файл (←)" } }, dIcon("chevronLeft", 26));
    const next = el("button", { type: "button", cls: "dk-view-nav next", attrs: { "aria-label": "Следующий файл (→)" } }, dIcon("chevronRight", 26));
    const closeB = iconButton("x", "Закрыть (Esc)", () => close(), "icon-btn");
    const overlay = el("div", { cls: "dk-view", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Просмотр файла" } },
      el("header", { cls: "dk-view-bar" }, el("div", { cls: "dk-view-title" }, title, counter), zoomOut, zoomIn, mdB, askB, infoB, dl, closeB),
      stage, prev, next);
    let textGen = 0;
    const setZoom = (z: number) => {
      zoom = Math.min(6, Math.max(1, z));
      const img = stage.querySelector<HTMLImageElement>("img"); if (!img) return;
      img.style.transform = zoom === 1 ? "" : `scale(${zoom})`;
      stage.classList.toggle("zoomed", zoom > 1);
    };
    const show = () => {
      const x = list[index]!;
      zoom = 1; title.textContent = x.name; title.title = x.name;
      counter.textContent = list.length > 1 ? index + 1 + " из " + list.length + " · " + human(x.size) : human(x.size);
      const kind = previewKind(x.name);
      zoomIn.hidden = zoomOut.hidden = kind !== "image";
      mdB.hidden = kind !== "markdown";
      mdB.setAttribute("aria-pressed", String(!rawMd));
      askB.hidden = !(deps.ask && askable(x.name));
      prev.hidden = next.hidden = list.length < 2;
      const url = diskRawUrl(x);
      let body: HTMLElement;
      if (kind === "image") {
        const img = el("img", { src: url, alt: x.name, decoding: "async" });
        img.addEventListener("click", () => setZoom(zoom > 1 ? 1 : 2));
        img.addEventListener("error", () => img.replaceWith(el("div", { cls: "dk-view-none" }, fileBadge(x.name, 96), el("p", { textContent: "Не удалось показать картинку." }))));
        body = img;
      } else if (kind === "video") body = el("video", { src: url, controls: true, preload: "metadata", attrs: { playsinline: "" } });
      else if (kind === "audio") body = el("div", { cls: "dk-view-audio" }, fileBadge(x.name, 96), el("audio", { src: url, controls: true, preload: "metadata" }));
      else if (kind === "pdf") body = el("iframe", { src: url, title: x.name });
      else if (kind === "text" || kind === "markdown" || kind === "table") {
        const box = el("div", { cls: "dk-view-doc" + (kind === "markdown" && !rawMd ? " md" : "") }, el("p", { cls: "muted", textContent: "Загрузка…" }));
        const gen = ++textGen;
        void fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error()))).then((t) => {
          if (gen !== textGen) return;
          const cut = t.length > 400000;
          const text = cut ? t.slice(0, 400000) : t;
          const tail = cut ? [el("p", { cls: "dk-view-cut", textContent: "Показано начало файла" })] : [];
          if (kind === "markdown" && !rawMd) box.replaceChildren(el("article", { cls: "prose dk-md" }, renderMarkdown(text)), ...tail);
          else if (kind === "table") box.replaceChildren(tableOf(parseCsv(text)), ...tail);
          else box.replaceChildren(el("pre", { cls: "dk-view-text", textContent: text }), ...tail);
        }).catch(() => { if (gen === textGen) box.replaceChildren(el("p", { textContent: "Не удалось прочитать файл." })); });
        body = box;
      } else if (kind === "office") {
        const box = el("div", { cls: "dk-view-doc" }, el("p", { cls: "muted", textContent: "Открываю…" }));
        const gen = ++textGen;
        void api.diskPreview(x.id).then((r) => {
          if (gen !== textGen) return;
          if (!r.ok) { box.replaceChildren(el("div", { cls: "dk-view-none" }, fileBadge(x.name, 96), el("p", { textContent: r.error.message }), btn("Скачать файл", () => download(x), { primary: true, icon: "download" }))); return; }
          box.replaceChildren(officeView(r.value));
        });
        body = box;
      } else {
        const get = btn("Скачать файл", () => download(x), { primary: true, icon: "download" });
        body = el("div", { cls: "dk-view-none" }, fileBadge(x.name, 110), el("p", { textContent: "Этот формат нельзя посмотреть в JUUNIBI. Скачайте файл и откройте его в своей программе." }), get);
      }
      stage.className = "dk-view-stage kind-" + (kind ?? "none");
      stage.replaceChildren(body);
    };
    const step = (d: number) => { if (list.length < 2) return; index = (index + d + list.length) % list.length; show(); };
    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target === stage) close(); });
    let touchX = 0;
    stage.addEventListener("touchstart", (e) => { touchX = e.touches[0]?.clientX ?? 0; }, { passive: true });
    stage.addEventListener("touchend", (e) => { const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX; if (zoom === 1 && Math.abs(dx) > 60) step(dx < 0 ? 1 : -1); });
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "ArrowLeft" && !(e.target instanceof HTMLMediaElement)) { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight" && !(e.target instanceof HTMLMediaElement)) { e.preventDefault(); step(1); }
      else if ((e.key === "+" || e.key === "=") && !zoomIn.hidden) setZoom(zoom * 1.5);
      else if (e.key === "-" && !zoomOut.hidden) setZoom(zoom / 1.5);
    };
    function close() {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      const id = list[index]?.id;
      if (id && cardOf(id)) focusCard(id); else opener?.focus();
    }
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    show();
    closeB.focus();
  }

  /** Rows as a table; the first row is the header when it looks like one (no numbers). */
  function tableOf(rows: string[][], limit = 500): HTMLElement {
    if (!rows.length) return el("p", { cls: "muted", textContent: "Пустая таблица." });
    const width = Math.max(...rows.map((r) => r.length));
    const headLike = rows.length > 1 && rows[0]!.every((c) => !/^-?[\d\s.,]+$/.test(c.trim()) || !c.trim());
    const cells = (r: string[], tag: "th" | "td") => el("tr", {}, ...Array.from({ length: width }, (_, i) => el(tag, { textContent: r[i] ?? "" })));
    return el("div", { cls: "dk-table-wrap" }, el("table", { cls: "dk-table" },
      ...(headLike ? [el("thead", {}, cells(rows[0]!, "th"))] : []),
      el("tbody", {}, ...rows.slice(headLike ? 1 : 0, limit).map((r) => cells(r, "td")))),
      ...(rows.length > limit ? [el("p", { cls: "dk-view-cut", textContent: "Показаны первые " + limit + " строк" })] : []));
  }
  /** Word, Excel, PowerPoint and ZIP as the server read them. */
  function officeView(p: DiskPreview): HTMLElement {
    const runs = (rs: { t: string; b?: true; i?: true }[]) => rs.map((r) => r.b || r.i ? el(r.b ? "strong" : "em", { textContent: r.t }) : document.createTextNode(r.t));
    if (p.kind === "doc") {
      const out: HTMLElement[] = [];
      let ul: HTMLElement | null = null;
      for (const b of p.blocks) {
        if (b.k === "li") { if (!ul) { ul = el("ul"); out.push(ul); } ul.append(el("li", {}, ...runs(b.runs))); continue; }
        ul = null;
        if (b.k === "h") out.push(el(("h" + Math.min(4, b.level + 1)) as "h2", {}, ...runs(b.runs)));
        else if (b.k === "table") out.push(tableOf(b.rows));
        else out.push(b.runs.length ? el("p", {}, ...runs(b.runs)) : el("p", { cls: "dk-gap" }));
      }
      return el("article", { cls: "prose dk-md dk-word" }, ...out, ...(p.truncated ? [el("p", { cls: "dk-view-cut", textContent: "Документ длинный: показано начало" })] : []));
    }
    if (p.kind === "sheet") {
      const host = el("div", { cls: "dk-sheet" });
      const tabs = el("div", { cls: "dk-sheet-tabs", attrs: { role: "tablist" } });
      const pick = (i: number) => {
        for (const [j, t] of [...tabs.children].entries()) t.setAttribute("aria-selected", String(j === i));
        const s = p.sheets[i]!;
        host.replaceChildren(s.rows.length ? tableOf(s.rows, 300) : el("p", { cls: "muted", textContent: "Лист пустой." }), ...(s.truncated ? [el("p", { cls: "dk-view-cut", textContent: "Показана часть листа" })] : []));
      };
      p.sheets.forEach((s, i) => { const t = el("button", { type: "button", cls: "chip", textContent: s.name, attrs: { role: "tab" } }); t.addEventListener("click", () => pick(i)); tabs.append(t); });
      pick(0);
      return el("div", { cls: "dk-sheet-view" }, ...(p.sheets.length > 1 ? [tabs] : []), host);
    }
    if (p.kind === "slides") return el("div", { cls: "dk-slides" }, ...p.slides.map((s, i) => el("section", { cls: "dk-slide" },
      el("small", { cls: "dk-slide-n", textContent: String(i + 1) }), el("h3", { textContent: s.title || "Слайд " + (i + 1) }),
      ...(s.lines.length ? [el("ul", {}, ...s.lines.map((l) => el("li", { textContent: l })))] : [el("p", { cls: "muted", textContent: "Без текста" })]))));
    const head = el("div", { cls: "dk-zip-head" }, dIcon("archive", 22), el("strong", { textContent: filesWord(p.total) }), el("small", { cls: "muted", textContent: human(p.bytes) + " после распаковки" }));
    return el("div", { cls: "dk-zip" }, head, el("div", { cls: "dk-zip-list" }, ...p.entries.map((e) => {
      const depth = e.name.replace(/\/$/, "").split("/").length - 1;
      const row = el("div", { cls: "dk-zip-row" + (e.dir ? " dir" : "") }, e.dir ? dIcon("folder", 16) : fileBadge(e.name.split("/").pop() ?? e.name, 20),
        el("span", { cls: "dk-zip-name", textContent: e.name.replace(/\/$/, "").split("/").pop() ?? e.name }), el("small", { cls: "muted", textContent: e.dir ? "" : human(e.size) }));
      row.style.setProperty("--depth", String(depth));
      return row;
    })), ...(p.truncated ? [el("p", { cls: "dk-view-cut", textContent: "Показаны первые 2000 строк" })] : []));
  }

  /* ---------------------------------------------------------------- «Спросить JUUNIBI о файле» */
  function askAbout(f: DiskFile) {
    if (!deps.ask) return;
    const PRESETS = ["Кратко перескажи этот файл: главное по пунктам.", "Какие в этом файле важные даты, суммы и сроки?", "Что мне нужно сделать по этому файлу?"];
    const q = el("textarea", { cls: "mem-input", rows: 3, value: PRESETS[0]!, attrs: { "aria-label": "Вопрос о файле" } });
    const chips = el("div", { cls: "dk-ask-chips" }, ...PRESETS.map((p, i) => {
      const c = el("button", { type: "button", cls: "chip", textContent: ["Пересказ", "Даты и суммы", "Что сделать"][i]! });
      c.addEventListener("click", () => { q.value = p; q.focus(); });
      return c;
    }));
    const note = el("small", { cls: "dk-form-note", attrs: { "aria-live": "polite" } });
    const go2 = btn("Спросить", async () => {
      const question = q.value.trim(); if (!question) { note.textContent = "Напишите вопрос"; return; }
      go2.disabled = true; note.textContent = "Читаю файл…";
      const r = await api.diskText(f.id);
      go2.disabled = false;
      if (!r.ok) { note.textContent = r.error.message; return; }
      sheet.close();
      // the chat takes text files up to 100 КБ: Cyrillic is two bytes a letter, so keep 45 000 characters
      const text = r.value.text.length > 45000 ? r.value.text.slice(0, 45000) + "\n\n[… дальше файл обрезан]" : r.value.text;
      deps.ask!(f.name.replace(/\.[^.]+$/, "") + ".txt", text, question + (r.value.truncated || text.length < r.value.text.length ? "\n\n(Файл большой, приложено его начало.)" : ""));
    }, { primary: true, icon: "send" });
    const body = el("div", { cls: "dk-form" }, el("div", { cls: "dk-ask-file" }, fileBadge(f.name, 36), el("div", {}, el("b", { textContent: f.name }), el("small", { cls: "muted", textContent: human(f.size) + " · текст файла уйдёт в чат вместе с вопросом" }))),
      chips, q, note, el("div", { cls: "dk-form-actions" }, btn("Отмена", () => sheet.close()), go2));
    const sheet = openSheet({ title: "Спросить JUUNIBI о файле", icon: "sparkle", content: body });
    body.closest(".mod-sheet")?.classList.add("dk-small-sheet");
    requestAnimationFrame(() => q.focus());
  }

  /* ---------------------------------------------------------------- tools in «⋯» */
  async function openAudit() {
    const body = el("div", { cls: "dk-audit" }, el("div", { cls: "dk-skel-line" }), el("div", { cls: "dk-skel-line" }));
    const sheet = openSheet({ title: "Проверка файлов", icon: "shield", sub: "Сверяем каждый файл и его версии с контрольной суммой, ищем одинаковые.", content: body });
    const [audit, dups] = await Promise.all([api.diskAudit(), api.diskDuplicates()]);
    if (!sheet.open) return;
    if (!audit.ok || !dups.ok) { body.replaceChildren(emptyState("alert", "Проверка недоступна", (!audit.ok ? audit.error.message : !dups.ok ? dups.error.message : ""))); return; }
    const a = audit.value;
    const bad = a.results.filter((x) => x.status !== "ok");
    const show = (id: string) => { const f = all.find((x) => x.id === id); if (!f) return; sheet.close(); go({ folder: f.folder }); reveal(id); };
    const head = (ok: boolean, title: string, text: string) => el("div", { cls: "dk-audit-head " + (ok ? "ok" : "warn") }, dIcon(ok ? "sparkleCheck" : "warn", 26), el("div", {}, el("strong", { textContent: title }), el("small", { cls: "muted", textContent: text })));
    const groups = dups.value.groups;
    const wasted = groups.reduce((n, g) => n + g.slice(1).reduce((v, f) => v + f.size, 0), 0);
    body.replaceChildren(
      head(!bad.length, bad.length ? "Есть проблемы: " + bad.length : "Все " + filesWord(a.total) + " целы", bad.length ? "Исправных " + a.ok + " из " + a.total : "Содержимое совпадает с контрольными суммами"),
      ...(bad.length ? [el("div", { cls: "dk-audit-list" }, ...bad.map((x) => el("div", { cls: "dk-audit-row" }, dIcon("warn", 17),
        el("span", {}, el("b", { textContent: x.name }), el("small", { cls: "muted", textContent: x.status === "missing" ? "Файл пропал с компьютера" : "Содержимое изменилось или повреждено" })),
        btn("Показать", () => show(x.id), { small: true }))))] : []),
      head(!a.revisionIssues?.length, a.revisionIssues?.length ? "Проблемы в версиях: " + a.revisionIssues.length : "Версии в порядке", "Проверено старых версий: " + (a.revisionsChecked ?? 0)),
      ...(a.revisionIssues?.length ? [el("div", { cls: "dk-audit-list" }, ...a.revisionIssues.map((v) => el("div", { cls: "dk-audit-row" }, dIcon("warn", 17),
        el("span", {}, el("b", { textContent: (all.find((f) => f.id === v.fileId)?.name ?? "Файл") + " · версия " + v.revision }), el("small", { cls: "muted", textContent: v.status === "missing" ? "Версия пропала" : "Версия повреждена" })),
        btn("Показать", () => show(v.fileId), { small: true }))))] : []),
      head(!groups.length, groups.length ? "Одинаковых групп: " + groups.length : "Одинаковых файлов нет", groups.length ? "Лишние копии занимают " + human(wasted) : "Каждый файл хранится в одном экземпляре"),
      ...groups.map((g) => {
        const keep = [...g].sort((x, y) => x.uploadedAt.localeCompare(y.uploadedAt))[0]!;
        const extra = g.filter((x) => x.id !== keep.id);
        const box = el("div", { cls: "dk-dup" },
          el("div", { cls: "dk-dup-head" }, fileBadge(keep.name, 34), el("span", {}, el("b", { textContent: keep.name }),  el("small", { cls: "muted", textContent: plural(g.length, "копия", "копии", "копий") + " · " + human(keep.size) + " каждая" })),
            btn("Оставить один", async () => { if (await trashFiles(extra.map((x) => x.id))) box.remove(); }, { small: true, icon: "check" })),
          ...g.map((x) => el("div", { cls: "dk-dup-row" + (x.id === keep.id ? " keep" : "") },
            el("span", { textContent: (x.folder || "Корень") + " / " + x.name }), x.id === keep.id ? el("small", { textContent: "останется" }) : null,
            btn("Показать", () => show(x.id), { small: true }))));
        return box;
      }));
  }
  async function openHistory() {
    const [files, foldersLog] = await Promise.all([api.diskFileHistory(), api.diskFolderHistory()]);
    if (!files.ok) { showToast(files.error.message); return; }
    type Row = { at: string; icon: DiskIconName; text: string; sub: string };
    const rows: Row[] = [
      ...files.value.actions.map((x): Row => x.before.name !== x.after.name
        ? { at: x.at, icon: "rename", text: "«" + x.before.name + "» → «" + x.after.name + "»", sub: "Переименован" }
        : { at: x.at, icon: "move", text: x.after.name, sub: "Перемещён: " + (x.before.folder || "Корень") + " → " + (x.after.folder || "Корень") }),
      ...(foldersLog.ok ? foldersLog.value.actions : []).map((x): Row => ({ at: x.at, icon: x.action === "trash" ? "trash" : x.action === "restore" ? "restore" : "folder", text: x.folder + (x.destination ? " → " + x.destination : ""), sub: FOLDER_ACTION[x.action] ?? x.action })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
    const undo = btn("Отменить последнее", () => { sheet.close(); void undoLast(); }, { small: true, icon: "undo", disabled: !files.value.actions.length });
    const body = rows.length ? el("div", { cls: "dk-history" }, undo, ...rows.map((r) => el("div", { cls: "dk-history-row" }, el("span", { cls: "dk-history-ic" }, dIcon(r.icon, 16)),
      el("span", { cls: "dk-history-text" }, el("b", { textContent: r.text }), el("small", { cls: "muted", textContent: r.sub })), el("time", { textContent: fmtTime(r.at) }))))
      : emptyState("clock", "Пока ничего не менялось", "Здесь появятся переименования, перемещения и действия с папками.");
    const sheet = openSheet({ title: "История", icon: "clock", sub: "Файлы и папки, сначала новые", content: body });
  }
  async function openDeletedFolders() {
    const r = await api.diskDeletedFolders();
    if (!r.ok) { showToast(r.error.message); return; }
    const body = r.value.folders.length ? el("div", { cls: "dk-history" }, ...r.value.folders.map((x) => {
      const row = el("div", { cls: "dk-history-row" }, el("span", { cls: "dk-history-ic" }, dIcon("folder", 16)),
        el("span", { cls: "dk-history-text" }, el("b", { textContent: x.root }), el("small", { cls: "muted", textContent: plural(x.count, "папка", "папки", "папок") + " · " + fmtTime(x.at) })),
        btn("Восстановить", async () => { const y = await api.diskFolderRestore(x.root); if (!y.ok) { showToast(y.error.message); return; } row.remove(); void loadCatalog(); showToast("Папка «" + x.root + "» восстановлена: " + filesWord(y.value.files)); }, { small: true }));
      return row;
    })) : emptyState("folder", "Удалённых папок нет", "Папки, удалённые в корзину, появятся здесь.");
    openSheet({ title: "Удалённые папки", icon: "folder", content: body });
  }
  async function exportCatalog() {
    const r = await api.diskSnapshot(); if (!r.ok) { showToast(r.error.message); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.value, null, 2)], { type: "application/json" }));
    const a = el("a", { href: url, attrs: { download: "JUUNIBI-disk-catalog.json" } }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    showToast("Каталог сохранён: список файлов и папок без содержимого");
  }
  function downloadBackup() {
    const a = el("a", { href: "/api/disk/backup", attrs: { download: "JUUNIBI-backup.ndjson" } }); document.body.append(a); a.click(); a.remove();
    showToast("Скачивается полная копия Диска с версиями. Сохраните её на другом носителе.", { ms: 10000 });
  }
  const restorePicker = el("input", { type: "file", accept: ".ndjson,.jsonl", hidden: true, attrs: { "aria-hidden": "true", tabindex: "-1" } });
  restorePicker.addEventListener("change", async () => {
    const file = restorePicker.files?.[0]; restorePicker.value = "";
    if (!file) return;
    if (!(await askConfirm({ title: "Восстановить из копии?", text: "Восстановление работает только на пустом Диске. Каждый файл сверится с контрольной суммой.", ok: "Восстановить", icon: "undo" }))) return;
    showToast("Восстанавливаю файлы из копии…");
    try {
      const res = await fetch("/api/disk/backup/restore", { method: "POST", headers: { "Content-Type": "application/x-ndjson" }, body: file });
      const out = (await res.json()) as { files?: number; error?: string };
      if (!res.ok) throw new Error(out.error ?? "Восстановление невозможно");
      showToast("Восстановлено: " + filesWord(out.files ?? 0)); void loadCatalog();
    } catch (e) { showToast(e instanceof Error ? e.message : "Ошибка восстановления"); }
  });

  /* ---------------------------------------------------------------- navigation and loading */
  function go(to: { folder?: string; view?: View; virtual?: Virtual }) {
    if (to.folder !== undefined) { current = to.folder; view = "all"; virtual = "none"; for (let p = parentOf(current); p; p = parentOf(p)) expanded.add(p); saveOpen(); }
    if (to.view) { view = to.view; virtual = "none"; }
    if (to.virtual) { view = "all"; virtual = to.virtual; }
    selected.clear(); limit = PAGE; focusId = null;
    redraw();
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }
  const renderCrumbs = () => {
    const part = (label: string, run?: () => void) => { const b = el(run ? "button" : "span", { cls: run ? "dk-crumb" : "dk-crumb now", textContent: label, ...(run ? { type: "button" } : {}) }); if (run) b.addEventListener("click", run); return b; };
    const sep = () => el("span", { cls: "dk-crumb-sep", attrs: { "aria-hidden": "true" } }, dIcon("chevronRight", 14));
    const parts: HTMLElement[] = [];
    if (view === "trash") parts.push(part("Корзина"));
    else if (view === "favorites") parts.push(part("Избранное"));
    else if (virtual !== "none") parts.push(part(VIRTUAL_TITLE[virtual]));
    else {
      parts.push(part("Диск", current ? () => go({ folder: "" }) : undefined));
      const segs = current ? current.split("/") : [];
      segs.forEach((s, i) => { const path = segs.slice(0, i + 1).join("/"); parts.push(sep(), part(s, i < segs.length - 1 ? () => go({ folder: path }) : undefined)); });
    }
    crumbs.replaceChildren(...parts);
  };
  function redraw() {
    renderCrumbs();
    renderTree();
    renderTrashBar();
    renderFiles();
    life.refresh();
    if (infoId && !byId(infoId)) closeInfo();
  }
  let loadGen = 0;
  /** One catalogue request (plus folder looks on the first load or after folder changes). */
  async function loadCatalog(withStyles = true) {
    const gen = ++loadGen;
    const [r, st, tr] = await Promise.all([api.diskList(), withStyles || !loaded ? api.diskFolderStyles() : Promise.resolve(null), loaded ? Promise.resolve(null) : api.diskTrash()]);
    if (gen !== loadGen || !page.isConnected) return;
    if (!r.ok) {
      loaded = true;
      filesBox.replaceChildren(emptyState("alert", "Диск недоступен", r.error.message, btn("Повторить", () => void loadCatalog(), { small: true, icon: "refresh" })));
      return;
    }
    folders = r.value.folders; all = r.value.files; trash = r.value.trash ?? []; used = r.value.usedBytes; maxBytes = r.value.maxFileBytes;
    if (st?.ok) styles = st.value;
    if (tr?.ok) keepDays = tr.value.days;
    if (current && !folders.includes(current)) current = "";
    loaded = true;
    redraw();
    showLinked();
  }
  /** A file opened from «Дела»: its folder, the file flashed, and the preview or «Сведения». */
  function showLinked() {
    const id = takeDiskLink(); if (!id) return;
    const f = all.find((x) => x.id === id);
    if (!f) { showToast(trash.some((x) => x.id === id) ? "Этот файл в корзине" : "Файла больше нет на Диске"); return; }
    go({ folder: f.folder }); reveal(f.id);
    if (previewKind(f.name)) openViewer(f); else openInfo(f.id);
  }
  const onLink = () => { if (!page.isConnected) { removeEventListener("juunibi:disk-link", onLink); return; } if (loaded) showLinked(); };
  addEventListener("juunibi:disk-link", onLink);

  /* ---------------------------------------------------------------- keyboard */
  page.addEventListener("keydown", (e) => {
    if (isTyping(e.target) || document.querySelector(".mod-modal, .dk-view")) return;
    const mod = e.ctrlKey || e.metaKey;
    const card = (e.target as HTMLElement).closest?.(".dk-file") as HTMLElement | null;
    const f = card ? byId(card.dataset.id!) : selected.size === 1 ? byId([...selected][0]!) : undefined;
    if (mod && e.code === "KeyA" && (card || selected.size || e.target === filesBox)) { e.preventDefault(); for (const x of shown) selected.add(x.id); renderSelBar(); return; }
    if (mod && e.code === "KeyC" && selected.size && view !== "trash") { e.preventDefault(); clipboard = { ids: [...selected], cut: false }; showToast("Скопировано: " + filesWord(selected.size)); renderSelBar(); return; }
    if (mod && e.code === "KeyX" && selected.size && view !== "trash") { e.preventDefault(); clipboard = { ids: [...selected], cut: true }; showToast("Вырезано: " + filesWord(selected.size)); renderSelBar(); return; }
    if (mod && e.code === "KeyV" && clipboard && view !== "trash") { e.preventDefault(); void paste(); return; }
    if (e.key === "Escape" && (selected.size || infoId)) { e.preventDefault(); if (selected.size) { selected.clear(); renderSelBar(); } else closeInfo(); return; }
    if (e.key === "Delete" && (selected.size || f)) { e.preventDefault(); const ids = selected.size ? [...selected] : [f!.id]; void (view === "trash" ? purgeFiles(ids) : trashFiles(ids)); return; }
    if (!f) return;
    if (e.key === "Enter" && card) { e.preventDefault(); if (view === "trash") pick(f.id, e, true); else openViewer(f); return; }
    if (e.key === "F2" && view !== "trash") { e.preventDefault(); void renameFile(f); return; }
    if (e.key === " " && card) { e.preventDefault(); pick(f.id, e, true); return; }
    if (card && ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const cards = [...filesBox.querySelectorAll<HTMLElement>(".dk-file")];
      const i = cards.indexOf(card);
      const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0]!.offsetTop).length);
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : -cols;
      const target = cards[Math.max(0, Math.min(cards.length - 1, i + d))];
      if (target) { focusCard(target.dataset.id!); if (e.shiftKey) pick(target.dataset.id!, e); }
    }
  });

  /* ---------------------------------------------------------------- drop files anywhere on the page */
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
  page.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth++;
    dropzone.querySelector("strong")!.textContent = "Отпустите, чтобы загрузить в «" + (uploadFolder() ? folderName(uploadFolder()) : "Корень Диска") + "»";
    page.classList.add("dk-file-over");
  });
  page.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } });
  page.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) page.classList.remove("dk-file-over"); });
  page.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; page.classList.remove("dk-file-over");
    // a dropped folder arrives as an entry tree; plain files keep the quick path
    const items = [...(e.dataTransfer?.items ?? [])];
    if (items.some((it) => it.webkitGetAsEntry?.()?.isDirectory)) void readDropped(items).then((list) => uploadTree(list)).catch(() => showToast("Не удалось прочитать папку"));
    else uploader.add([...(e.dataTransfer?.files ?? [])], uploadFolder());
  });

  /* ---------------------------------------------------------------- drag files into the chat */
  const chatDrop = el("div", { cls: "dk-chatdrop", attrs: { "aria-hidden": "true" } }, dIcon("chatIn", 22), el("span", { textContent: "В беседу" }));
  if (deps.attach) {
    chatDrop.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes(DISK_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; chatDrop.classList.add("drop"); } });
    chatDrop.addEventListener("dragleave", () => chatDrop.classList.remove("drop"));
    chatDrop.addEventListener("drop", (e) => {
      chatDrop.classList.remove("drop"); page.classList.remove("dk-dragging");
      const ids = e.dataTransfer?.getData(DISK_DRAG); if (!ids) return;
      e.preventDefault(); e.stopPropagation();
      void attachToChat(JSON.parse(ids) as string[]);
    });
  } else chatDrop.hidden = true;

  /* ---------------------------------------------------------------- assemble */
  const life = diskLifePanel(() => loaded && !all.length && !trash.length);
  const layout = el("div", { cls: "dk-layout" + (treeHidden ? " no-tree" : "") }, side, main, life.root, info);
  page.append(el("h1", { cls: "sr-only", textContent: "Диск" }), bar, layout, scrim, uploader.root, picker, folderPicker, restorePicker, chatDrop);
  renderFiles();
  void loadCatalog();
  return page;
}
