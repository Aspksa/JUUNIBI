import { api } from "../api";
import { el, icon, short, type IconName } from "../dom";
import { app, checkUpdate, downloadUpdate, type AppState } from "../state";
import {
  buildUpdateModel, filterFiles, groupFiles,
  type Change, type FileRow, type FileState, type Filter, type Step, type UpdateModel,
} from "./update-model";

/** Interaction state that must survive re-renders (the page is rebuilt whenever status/events change). */
const UI = { filter: "changed" as Filter, open: new Map<string, boolean>(), logOpen: false };

const HERO_ICON: Record<UpdateModel["tone"], IconName> = { neutral: "update", ok: "circleCheck", info: "update", busy: "update", danger: "alert" };
const STATE_ICON: Record<FileState, string> = { waiting: "·", downloading: "", downloaded: "↓", verified: "✓", installed: "✓", removed: "✓", failed: "✕" };
const STATE_TITLE: Record<FileState, string> = { waiting: "ожидает", downloading: "скачивается", downloaded: "скачан", verified: "проверен", installed: "установлен", removed: "удалён", failed: "ошибка" };
const CHANGE_GLYPH: Record<Change, string> = { added: "+", modified: "~", removed: "−", unchanged: "=" };
const CHANGE_TITLE: Record<Change, string> = { added: "новый", modified: "изменён", removed: "будет удалён", unchanged: "без изменений" };
const MAX_ROWS = 150;
const MAX_GROUPS = 80;

const spinner = (cls = "") => el("i", { cls: ("spin " + cls).trim(), attrs: { role: "presentation" } });

function button(label: string, run: () => void, o: { primary?: boolean; disabled?: boolean; busy?: boolean } = {}): HTMLButtonElement {
  const b = el("button", { type: "button", cls: "btn" + (o.primary ? " primary" : ""), disabled: !!o.disabled }, o.busy ? spinner("sm") : null, label);
  b.addEventListener("click", run);
  return b;
}

function hero(s: AppState, m: UpdateModel): HTMLElement {
  const u = s.update;
  const hasLatest = !!u?.latest;
  const differs = hasLatest && u!.localVersion !== u!.latest!.sha;
  const actions: HTMLElement[] = [];
  if (m.action === "check") actions.push(button("Проверить обновления", () => void checkUpdate(), { primary: true }));
  if (m.action === "download") { actions.push(button("Скачать и проверить", () => void downloadUpdate(), { primary: true })); actions.push(button("Проверить снова", () => void checkUpdate())); }
  if (m.action === "busy") actions.push(button("Выполняется…", () => {}, { primary: true, disabled: true, busy: true }));
  const versions = hasLatest ? el("div", { cls: "upd-versions" },
    el("span", { cls: "upd-ver" }, el("small", { textContent: "Установлена" }), el("code", { textContent: short(u!.localVersion) })),
    differs ? el("span", { cls: "upd-arrow", textContent: "→", attrs: { "aria-hidden": "true" } }) : null,
    differs ? el("span", { cls: "upd-ver new" }, el("small", { textContent: "Новая" }), el("code", { textContent: short(u!.latest!.sha) })) : null) : null;
  const meta = [u?.latest?.date ? new Date(u.latest.date).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" }) : "", "github.com/Aspksa/JUUNIBI"].filter(Boolean).join(" · ");

  const next = m.action === "restart"
    ? el("div", { cls: "upd-next" }, el("strong", { textContent: "Что дальше" }),
        el("ol", {}, el("li", { textContent: "Закройте JUUNIBI." }), el("li", {}, "Запустите снова через ", el("code", { textContent: "JUUNIBI.bat" }), " или ", el("code", { textContent: "npm start" }), "."),
          el("li", { textContent: "Установка пройдёт сама: резервная копия, проверка файлов, проверка запуска. При сбое всё откатится." })))
    : null;

  return el("section", { cls: `upd-hero tone-${m.tone}` },
    el("div", { cls: "upd-hero-icon" }, m.tone === "busy" ? spinner("lg") : icon(HERO_ICON[m.tone], 28)),
    el("div", { cls: "upd-hero-main" },
      el("h2", { textContent: m.headline }), m.sub ? el("p", { cls: "upd-sub", textContent: m.sub }) : null,
      versions, el("p", { cls: "upd-meta", textContent: meta }), next,
      actions.length ? el("div", { cls: "row upd-actions" }, ...actions) : null,
      u?.phase === "downloading" ? progressBar(u.percent, `${u.percent}% · ${u.downloadedFiles} из ${u.totalFiles} файлов`) : null,
      u?.phase === "downloading" || u?.phase === "testing" ? lane(m) : null));
}

function progressBar(percent: number, label: string): HTMLElement {
  const p = el("progress", { max: 100, value: percent, attrs: { "aria-label": "Прогресс скачивания" } });
  return el("div", { cls: "upd-progress" }, p, el("span", { cls: "muted", textContent: label }));
}

/** Compact transfer lane: GitHub -> checks -> your project; a chip flies along it on real events. */
function lane(m: UpdateModel): HTMLElement {
  const node = (cls: string, ic: IconName, label: string) => el("div", { cls: `lane-node ${cls}` }, el("span", { cls: "lane-dot" }, icon(ic, 18)), el("small", { textContent: label }));
  return el("div", { cls: "upd-lane", attrs: { "aria-hidden": "true" } },
    el("div", { cls: "lane-row" }, node("lane-n0", "cloud", "GitHub"), el("span", { cls: "lane-track" }), node("lane-n1", "shield", "Проверка"), el("span", { cls: "lane-track" }), node("lane-n2", "folder", "Ваш проект")),
    m.current ? el("p", { cls: "lane-current", textContent: m.current }) : null);
}

function stepper(steps: Step[]): HTMLElement {
  const mark = (st: Step, i: number): Node => st.status === "done" ? icon("check", 14) : st.status === "active" ? spinner("sm") : st.status === "error" ? icon("x", 14) : el("span", { textContent: String(i + 1) });
  return el("ol", { cls: "upd-steps", attrs: { "aria-label": "Этапы обновления" } }, ...steps.map((st, i) =>
    el("li", { cls: `upd-step ${st.status}`, attrs: st.status === "active" ? { "aria-current": "step" } : {} },
      el("span", { cls: "upd-step-dot" }, mark(st, i)),
      el("div", { cls: "upd-step-text" }, el("strong", { textContent: st.title }), el("span", { cls: "muted", textContent: st.detail }),
        st.progress !== undefined ? el("progress", { max: 100, value: st.progress, attrs: { "aria-label": st.title } }) : null))));
}

function resultCards(s: AppState, m: UpdateModel): HTMLElement[] {
  const out: HTMLElement[] = [];
  const i = m.installed;
  if (i) {
    const when = new Date(i.at).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
    out.push(el("section", { cls: `upd-card ${i.ok && i.healthy !== false ? "ok" : "danger"}` }, icon(i.ok ? "circleCheck" : "alert", 22),
      el("div", {}, el("strong", { textContent: i.ok ? (i.healthy === false ? "Установлено, но проверка запуска не пройдена" : "Обновление установлено") : "Установка не удалась — выполнен откат" }),
        el("p", { cls: "muted", textContent: i.ok ? `${i.sha ? short(i.sha) + " · " : ""}${when}${i.healthy ? " · проверка запуска пройдена" : ""}` : `${when} · ${i.message}` }),
        i.ok && i.backup ? el("p", { cls: "muted" }, "Резервная копия: ", el("code", { textContent: i.backup })) : null)));
  }
  const removals = s.update?.pendingRemovals ?? [];
  if (s.update?.phase === "ready" && removals.length) {
    const confirm = button(s.update.removalsConfirmed ? "Удаление подтверждено" : "Подтвердить удаление", () => void api.updateConfirmRemovals().then((r) => { if (r.ok) app.set({ update: r.value }); }), { disabled: !!s.update.removalsConfirmed, primary: !s.update.removalsConfirmed });
    out.push(el("section", { cls: "upd-card warn", attrs: { role: "group" } }, icon("alert", 22),
      el("div", { cls: "grow" }, el("strong", { textContent: `Новая версия больше не содержит ${removals.length} файл(ов)` }),
        el("p", { cls: "muted", textContent: "Они удалятся при установке только после вашего подтверждения; резервная копия создаётся." }),
        el("ul", { cls: "upd-removals" }, ...removals.slice(0, 40).map((r) => el("li", {}, el("code", { textContent: r })))),
        removals.length > 40 ? el("p", { cls: "muted", textContent: `…и ещё ${removals.length - 40}` }) : null, confirm)));
  }
  return out;
}

function fileRow(f: FileRow): HTMLElement {
  const name = f.path.split("/").pop() ?? f.path;
  return el("li", { cls: `upd-file ${f.state}`, title: f.path },
    el("span", { cls: `chg ${f.change}`, textContent: CHANGE_GLYPH[f.change], attrs: { title: CHANGE_TITLE[f.change], "aria-label": CHANGE_TITLE[f.change] } }),
    el("span", { cls: "upd-file-name" + (f.change === "removed" ? " removed" : ""), textContent: name }),
    f.state === "downloading" ? spinner("sm") : el("span", { cls: "file-state", textContent: STATE_ICON[f.state], attrs: { title: STATE_TITLE[f.state], "aria-label": STATE_TITLE[f.state] } }));
}

function changes(m: UpdateModel, hasNew: boolean): HTMLElement | null {
  if (!m.files.length) return hasNew ? el("section", { cls: "upd-changes" }, el("h2", { textContent: "Что изменится" }), el("p", { cls: "muted", textContent: "Список файлов появится, как только начнётся загрузка." })) : null;
  const c = m.counts;
  const changed = c.added + c.modified + c.removed;
  const chip = (f: Filter, label: string, n: number) => {
    const b = el("button", { type: "button", cls: "upd-chip", attrs: { "aria-pressed": String(UI.filter === f) } }, label, el("span", { cls: "n", textContent: String(n) }));
    b.addEventListener("click", () => { UI.filter = f; rerender(); });
    return b;
  };
  const rows = filterFiles(m.files, UI.filter);
  const groups = groupFiles(rows);
  const autoOpen = rows.length <= 30;
  const list = el("div", { cls: "upd-groups" }, ...groups.slice(0, MAX_GROUPS).map((g) => {
    const key = UI.filter + "|" + g.dir;
    const open = UI.open.get(key) ?? (autoOpen || g.failed > 0);
    const d = el("details", { cls: "upd-group", open }, el("summary", {}, icon("folder", 16), el("span", { cls: "upd-dir", textContent: g.dir }),
      el("span", { cls: "tag", textContent: String(g.files.length) }), g.done ? el("span", { cls: "tag ok", textContent: `✓ ${g.done}` }) : null, g.failed ? el("span", { cls: "tag danger", textContent: `✕ ${g.failed}` }) : null));
    const fill = () => {
      const ul = el("ul", { cls: "upd-files" }, ...g.files.slice(0, MAX_ROWS).map(fileRow));
      if (g.files.length > MAX_ROWS) ul.append(el("li", { cls: "muted upd-more", textContent: `…и ещё ${g.files.length - MAX_ROWS}` }));
      d.append(ul);
    };
    if (open) fill(); // rows of closed folders are built only when opened (lists can hold thousands of files)
    d.addEventListener("toggle", () => { UI.open.set(key, d.open); if (d.open && !d.querySelector("ul")) fill(); });
    return d;
  }), groups.length > MAX_GROUPS ? el("p", { cls: "muted", textContent: `…и ещё ${groups.length - MAX_GROUPS} папок` }) : null);
  return el("section", { cls: "upd-changes" }, el("h2", { textContent: "Что изменится" }),
    el("div", { cls: "upd-chips", attrs: { role: "group", "aria-label": "Фильтр файлов" } }, chip("changed", "Все изменения", changed), chip("added", "Новые", c.added), chip("modified", "Изменённые", c.modified), chip("removed", "Удалённые", c.removed), chip("unchanged", "Без изменений", c.unchanged)),
    rows.length ? list : el("p", { cls: "muted", textContent: "В этой категории файлов нет." }));
}

function logPanel(s: AppState): HTMLElement | null {
  const events = [...new Map(s.updateEvents.map((e) => [e.event_id, e])).values()];
  if (!events.length) return null;
  const d = el("details", { cls: "upd-log", open: UI.logOpen }, el("summary", {}, icon("list", 16), `Журнал событий · ${events.length}`),
    el("div", { cls: "upd-log-body" }, ...events.slice(-120).reverse().map((e) => el("p", {}, el("time", { textContent: new Date(e.timestamp).toLocaleTimeString("ru-RU") }), el("b", { textContent: e.type }), e.relative_path ? el("span", { textContent: e.relative_path }) : null, e.message ? el("em", { textContent: e.message }) : null))));
  d.addEventListener("toggle", () => { UI.logOpen = d.open; });
  return d;
}

let rerender: () => void = () => {};
export function setUpdateRerender(fn: () => void) { rerender = fn; }

export function updatePage(s: AppState): HTMLElement {
  const m = buildUpdateModel(s.update, s.updateEvents);
  const hasNew = !!s.update?.latest && s.update.localVersion !== s.update.latest.sha;
  return el("div", { cls: "page upd" },
    el("h1", { textContent: "Обновление" }),
    el("p", { cls: "muted lead", textContent: "Файлы скачиваются и проверяются во временной папке; работающая версия не трогается, пока всё не пройдёт проверку." }),
    hero(s, m), stepper(m.steps), ...resultCards(s, m),
    changes(m, hasNew), logPanel(s),
    s.updateError ? el("p", { cls: "bad", textContent: s.updateError }) : null);
}

let lastFlight = "";
/** Animates the real event along the lane (download -> checks, install -> project). Never blocks; skipped for reduced motion. */
export function animateFlight(host: HTMLElement, s: AppState) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const event = [...s.updateEvents].reverse().find((e) => e.relative_path && (e.type === "file_download_done" || e.type === "file_install_done"));
  if (!event || event.event_id === lastFlight) return;
  const from = host.querySelector<HTMLElement>(event.type === "file_install_done" ? ".lane-n1 .lane-dot" : ".lane-n0 .lane-dot");
  const to = host.querySelector<HTMLElement>(event.type === "file_install_done" ? ".lane-n2 .lane-dot" : ".lane-n1 .lane-dot");
  if (!from || !to) return; // lane is only shown while a transfer is running
  lastFlight = event.event_id;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const x = a.left + a.width / 2, y = a.top + a.height / 2;
  const dx = b.left + b.width / 2 - x, dy = b.top + b.height / 2 - y;
  const chip = el("div", { cls: "update-flight-overlay", textContent: event.relative_path.split("/").pop() ?? "Файл" });
  chip.style.left = x + "px"; chip.style.top = y + "px";
  document.body.append(chip);
  const anim = chip.animate([
    { transform: "translate(-50%,-50%) scale(.8)", opacity: 0.5 },
    { transform: `translate(calc(-50% + ${dx / 2}px),calc(-50% + ${dy / 2 - 18}px)) scale(1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.8)`, opacity: 0.2 },
  ], { duration: 800, easing: "ease-in-out" });
  void anim.finished.then(() => chip.remove(), () => chip.remove());
}

