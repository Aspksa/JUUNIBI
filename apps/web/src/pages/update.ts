import { api } from "../api";
import { el, icon, short, type IconName } from "../dom";
import { pageHead } from "./kit";
import { plural } from "./brain-model";
import { app, cancelUpdate, checkUpdate, dismissInstallWarning, downloadUpdate, installNow, requestRollback, saveUpdateConfig, type AppState } from "../state";
import type { UpdateCi, UpdateConfig } from "../api";
import {
  buildUpdateModel, filterFiles, formatBytes, groupFiles,
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

const CI_TEXT: Record<UpdateCi, string> = { success: "проверки пройдены", pending: "проверки ещё идут", failure: "проверки не пройдены", none: "проверок нет", unknown: "проверки не определены" };
const CI_TONE: Record<UpdateCi, string> = { success: "ok", pending: "warn", failure: "bad", none: "warn", unknown: "warn" };

function hero(s: AppState, m: UpdateModel): HTMLElement {
  const u = s.update;
  const hasLatest = !!u?.latest;
  const differs = hasLatest && u!.localVersion !== u!.latest!.sha;
  const restarting = s.updateRestarting;
  const actions: HTMLElement[] = [];
  if (!restarting) {
    if (m.action === "check") actions.push(button("Проверить обновления", () => void checkUpdate(), { primary: true }));
    if (m.action === "download") {
      const go = button("Скачать и проверить", () => void downloadUpdate(), { primary: true, disabled: !!m.blocked });
      if (m.blocked) go.title = m.blocked;
      actions.push(go, button("Проверить снова", () => void checkUpdate()));
    }
    if (m.action === "busy") {
      actions.push(button("Выполняется…", () => {}, { primary: true, disabled: true, busy: true }));
      if (u?.phase === "downloading" || u?.phase === "testing") actions.push(button("Отменить", () => void cancelUpdate()));
    }
    if (m.action === "restart") {
      const warn = u?.activity ?? [];
      const confirm = s.updateWarnings.length ? s.updateWarnings : [];
      actions.push(button("Установить сейчас", () => void installNow(false), { primary: true }));
      if (warn.length && !confirm.length) actions.push(el("span", { cls: "muted upd-hint", textContent: "Сейчас: " + warn.join(", ") + " — перезапуск это прервёт." }));
    }
  }
  const versions = hasLatest ? el("div", { cls: "upd-versions" },
    el("span", { cls: "upd-ver" }, el("small", { textContent: "Установлена" }), el("code", { textContent: short(u!.localVersion) })),
    differs ? el("span", { cls: "upd-arrow", textContent: "→", attrs: { "aria-hidden": "true" } }) : null,
    differs ? el("span", { cls: "upd-ver new" }, el("small", { textContent: u!.latest!.tag ? "Выпуск" : "Новая" }), el("code", { textContent: u!.latest!.tag ?? short(u!.latest!.sha) })) : null,
    differs && m.ci ? el("span", { cls: `upd-ci ${CI_TONE[m.ci]}`, title: "Результат автоматических проверок проекта на GitHub" }, "CI: " + CI_TEXT[m.ci]) : null) : null;
  const meta = [u?.latest?.date ? new Date(u.latest.date).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" }) : "", "github.com/Aspksa/JUUNIBI"].filter(Boolean).join(" · ");

  const next = m.action === "restart" && !restarting
    ? el("div", { cls: "upd-next" }, el("strong", { textContent: "Что будет" }),
        el("ol", {}, el("li", { textContent: "JUUNIBI сам перезапустится (несколько секунд), страница обновится." }),
          el("li", { textContent: "Установка: резервная копия, замена только изменённых файлов, проверка запуска. Если новая версия не запустится, вернётся прежняя." }),
          el("li", {}, "Запущено не через лаунчер? Закройте JUUNIBI и откройте снова через ", el("code", { textContent: "JUUNIBI.bat" }), " или ", el("code", { textContent: "npm start" }), ".")))
    : null;
  const confirmBlock = s.updateWarnings.length && !restarting
    ? el("div", { cls: "upd-card warn", attrs: { role: "alert" } }, icon("alert", 22),
        el("div", { cls: "grow" }, el("strong", { textContent: "Перезапуск прервёт текущую работу" }),
          el("ul", { cls: "upd-removals" }, ...s.updateWarnings.map((w) => el("li", { textContent: w }))),
          el("div", { cls: "row upd-actions" }, button("Всё равно установить", () => void installNow(true), { primary: true }), button("Подождать", () => dismissInstallWarning()))))
    : null;
  const progress = restarting
    ? el("div", { cls: "upd-restart" }, spinner("sm"), el("span", { textContent: restarting === "rollback" ? "Возвращаем прежнюю версию… Страница обновится сама." : "Устанавливаем обновление… Страница обновится сама." }))
    : null;
  const saved = u && (u.reusedFiles ?? 0) > 0 && u.treeBytes && u.phase !== "idle"
    ? el("p", { cls: "muted upd-saved", textContent: `${u.reusedFiles} ${plural(u.reusedFiles ?? 0, ["файл", "файла", "файлов"])} без изменений уже на диске — не скачиваются (экономия ${formatBytes(Math.max(0, u.treeBytes - u.totalBytes))}).` })
    : null;

  return el("section", { cls: `upd-hero tone-${restarting ? "busy" : m.tone}` },
    el("div", { cls: "upd-hero-icon" }, m.tone === "busy" || restarting ? spinner("lg") : icon(HERO_ICON[m.tone], 28)),
    el("div", { cls: "upd-hero-main" },
      el("h2", { textContent: restarting ? "Идёт установка" : m.headline }), !restarting && m.sub ? el("p", { cls: "upd-sub", textContent: m.sub }) : null,
      versions, el("p", { cls: "upd-meta", textContent: meta }),
      m.blocked ? el("p", { cls: "upd-blocked", textContent: m.blocked }) : null,
      next, confirmBlock, progress,
      actions.length ? el("div", { cls: "row upd-actions" }, ...actions) : null,
      u?.phase === "downloading" ? progressBar(u.percent, `${u.percent}% · ${u.downloadedFiles} из ${u.totalFiles} файлов`) : null,
      saved,
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
    const title = i.kind === "rollback" ? "Выполнен откат на предыдущую версию" : i.kind === "startup_failed" ? "Новая версия не запустилась — возвращена прежняя"
      : i.ok ? (i.healthy === false ? "Установлено, но проверка запуска не пройдена" : "Обновление установлено") : "Установка не удалась — выполнен откат";
    out.push(el("section", { cls: `upd-card ${i.ok && i.healthy !== false ? "ok" : "danger"}` }, icon(i.ok ? "circleCheck" : "alert", 22),
      el("div", {}, el("strong", { textContent: title }),
        el("p", { cls: "muted", textContent: i.ok && i.kind === "install" ? `${i.sha ? short(i.sha) + " · " : ""}${when}${i.healthy ? " · проверка запуска пройдена" : ""}` : `${when}${i.message ? " · " + i.message : ""}` }),
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


const CHECK_MARK: Record<string, string> = { todo: "·", active: "", done: "✓", error: "✕" };
/** Install / types / tests / build as they actually ran, with the end of the log when one failed. */
function checksCard(s: AppState): HTMLElement | null {
  const u = s.update;
  const checks = u?.checks ?? [];
  if (!u || !checks.length || !(u.phase === "testing" || u.phase === "ready" || u.phase === "error") || checks.every((c) => c.status === "todo")) return null;
  return el("section", { cls: "upd-checks" }, el("h2", { textContent: "Проверки во временной папке" }),
    el("ul", { cls: "upd-check-list" }, ...checks.map((c) => el("li", { cls: `upd-check ${c.status}` },
      c.status === "active" ? spinner("sm") : el("span", { cls: "chk", textContent: CHECK_MARK[c.status] }), el("span", { textContent: c.title })))),
    u.phase === "error" && u.logTail ? el("details", { open: true }, el("summary", { textContent: "Что вывела проверка" }), el("pre", { cls: "upd-logtail", textContent: u.logTail })) : null);
}

/** Titles of the commits between the installed and the new version. */
function whatsNew(s: AppState, hasNew: boolean): HTMLElement | null {
  const l = s.update?.latest;
  if (!hasNew || !l?.changes?.length) return null;
  const more = (l.changesTotal ?? 0) - l.changes.length;
  return el("section", { cls: "upd-news" }, el("h2", { textContent: "Что нового" }),
    el("ul", { cls: "upd-news-list" }, ...l.changes.map((c) => el("li", {},
      el("span", { textContent: c.title }),
      c.pr ? el("a", { href: `https://github.com/Aspksa/JUUNIBI/pull/${c.pr}`, target: "_blank", rel: "noopener noreferrer", cls: "upd-pr", textContent: `#${c.pr}` }) : null))),
    more > 0 ? el("p", { cls: "muted", textContent: `…и ещё ${more} ${plural(more, ["изменение", "изменения", "изменений"])}` }) : null);
}

function settingsCard(s: AppState): HTMLElement | null {
  const c = s.update?.config;
  if (!c) return null;
  const busy = s.update?.phase === "downloading" || s.update?.phase === "testing";
  const field = <K extends keyof UpdateConfig>(label: string, key: K, options: [UpdateConfig[K], string][], hint: string) => {
    const sel = el("select", { attrs: { "aria-label": label } }, ...options.map(([v, t]) => el("option", { value: String(v), textContent: t, selected: v === c[key] })));
    sel.disabled = busy && key === "channel";
    sel.addEventListener("change", () => void saveUpdateConfig({ [key]: sel.value } as Partial<UpdateConfig>));
    return el("label", { cls: "upd-field" }, el("span", {}, el("strong", { textContent: label }), el("small", { cls: "muted", textContent: hint })), sel);
  };
  return el("section", { cls: "upd-settings" }, el("h2", { textContent: "Настройки обновления" }),
    field("Канал", "channel", [["fresh", "Свежий (последние изменения)"], ["stable", "Стабильный (только выпуски)"]], "Свежий — каждая версия, прошедшая проверки; стабильный — только помеченные выпуски."),
    field("Автопроверка", "autoCheck", [["hourly", "Каждый час"], ["daily", "Раз в сутки"], ["off", "Выключена"]], "JUUNIBI сам смотрит, есть ли новая версия, и показывает отметку в меню. Ничего не скачивается без вашего согласия."),
    tokenField(s));
}

/** Without a token GitHub allows 60 requests an hour per network; a personal token raises it to 5000. */
function tokenField(s: AppState): HTMLElement {
  const g = s.update?.github;
  const input = el("input", { type: "password", autocomplete: "off", spellcheck: false, placeholder: g?.token === "saved" ? "Токен сохранён — вставьте новый, чтобы заменить" : "ghp_… или github_pat_…", attrs: { "aria-label": "Токен GitHub" } });
  const until = g?.rateLimitedUntil ? new Date(g.rateLimitedUntil).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
  const hint = g?.token === "env" ? "Используется GITHUB_TOKEN из .env." : g?.token === "saved" ? "Токен сохранён на этом компьютере и никуда не отправляется, кроме GitHub." :
    "Необязательно. Без токена GitHub даёт около 60 проверок в час на вашу сеть. Подойдёт токен без прав (public repositories, read-only).";
  return el("div", { cls: "upd-field" },
    el("span", {}, el("strong", { textContent: "Токен GitHub" }), el("small", { cls: "muted", textContent: hint + (until ? ` Сейчас лимит исчерпан до ${until}.` : "") })),
    el("div", { cls: "row" }, input,
      button("Сохранить", () => { const v = input.value.trim(); if (v) void saveUpdateConfig({ githubToken: v }); }),
      g?.token === "saved" ? button("Удалить", () => void saveUpdateConfig({ githubToken: "" })) : null));
}

const KIND_TEXT: Record<string, string> = { install: "Установлена", rollback: "Откат", failed: "Не установлена (откат)", startup_failed: "Не запустилась (возвращена прежняя)" };
function historyCard(s: AppState): HTMLElement[] {
  const h = s.updateHistory;
  const out: HTMLElement[] = [];
  if (s.update?.rollbackPending) {
    out.push(el("section", { cls: "upd-card warn", attrs: { role: "group" } }, icon("alert", 22),
      el("div", { cls: "grow" }, el("strong", { textContent: "Откат на предыдущую версию запланирован" }),
        el("p", { cls: "muted", textContent: "Он выполнится при перезапуске JUUNIBI. Ваши данные, ключи и настройки не затрагиваются." }),
        el("div", { cls: "row upd-actions" },
          s.updateRestarting ? null : button("Откатить сейчас", () => void installNow(false), { primary: true }),
          s.updateRestarting ? null : button("Отменить откат", () => void requestRollback(true))))));
  }
  if (!h || !h.items.length) return out;
  const can = h.canRollback && !s.update?.rollbackPending && s.update?.phase !== "downloading" && s.update?.phase !== "testing" ? h.canRollback : null;
  out.push(el("section", { cls: "upd-history" }, el("h2", { textContent: "История обновлений" }),
    can ? el("div", { cls: "upd-rollback" }, el("span", { textContent: `Можно вернуться на версию ${can.from ? short(can.from) : "до обновления"}.` }),
      button("Откатить на предыдущую версию", () => void requestRollback(false))) : null,
    el("ul", { cls: "upd-history-list" }, ...h.items.slice(0, 10).map((it) => el("li", { cls: `h-${it.kind}` },
      el("time", { textContent: new Date(it.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) }),
      el("strong", { textContent: KIND_TEXT[it.kind] ?? it.kind }),
      el("code", { textContent: short(it.kind === "rollback" ? it.to : it.kind === "install" ? it.to : it.to || it.from) }),
      it.message ? el("em", { cls: "muted", textContent: it.message }) : null)))));
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
    pageHead("update", "Обновление", "Файлы скачиваются и проверяются во временной папке; работающая версия не трогается, пока всё не пройдёт проверку."),
    hero(s, m), stepper(m.steps), ...resultCards(s, m), ...historyCard(s),
    checksCard(s), whatsNew(s, hasNew), changes(m, hasNew), settingsCard(s), logPanel(s),
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

