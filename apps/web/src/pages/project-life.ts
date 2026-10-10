/**
 * «Жизнь проекта»: the panel beside the update centre with 85 figures about JUUNIBI's history,
 * grouped and drawn as tiles, each with a small chart (life-charts.ts).
 * The element is built once and kept, because the update page is rebuilt on every status change.
 */
import { api, type ProjectMetric, type ProjectStatsData } from "../api";
import { el, icon, iconButton } from "../dom";
import { barChart, miniChart, ringChart } from "./life-charts";

const OPEN_KEY = "juunibi.life.open";
const GROUP_ICON: Record<string, string> = { anatomy: "🧬", mind: "🧠", life: "🌿", care: "🛡️", fun: "🎲", code: "🔬" };
const HIGHLIGHTS = ["age", "words_added", "tests", "experiments"];
const HOURS_LABEL = ["0", "6", "12", "18", "23"];

let host: HTMLElement | null = null;
let loadedAt = 0;
let data: ProjectStatsData | null = null;
let error = "";
let loading = false;

const readOpen = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '["anatomy","mind"]') as string[]); } catch { return new Set(["anatomy", "mind"]); } };
const saveOpen = (s: Set<string>) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch { /* private mode */ } };

/** «5 минут назад» for the time the figures were counted. */
export function agoText(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** Five weeks of commits, oldest top-left, as a heat grid. */
function heat(series: number[]): HTMLElement {
  const max = Math.max(1, ...series);
  return el("div", { cls: "life-heat", attrs: { "aria-hidden": "true" } }, ...series.map((v, i) => {
    const c = el("i", { title: `${v} коммитов` });
    c.style.setProperty("--a", v ? String(0.25 + (0.75 * v) / max) : "0");
    c.style.setProperty("--d", String(i));
    return c;
  }));
}

function tile(m: ProjectMetric, i: number): HTMLElement {
  const empty = m.value === "—";
  const wide = m.kind === "hours" && m.series ? el("div", {}, barChart(m.series, m.series.map((_, h) => `${h}:00`), "hours"), el("div", { cls: "life-axis" }, ...HOURS_LABEL.map((x) => el("span", { textContent: x }))))
    : m.kind === "calendar" && m.series ? heat(m.series)
    : m.kind === "list" && m.list ? el("ul", { cls: "life-list" }, ...m.list.map((x) => el("li", { cls: x.startsWith("✓") ? "on" : x.startsWith("·") ? "off" : "", textContent: x })))
    : null;
  const mini = wide || empty ? null : miniChart(m.kind, m.series, m.labels, m.list);
  const ring = typeof m.ring === "number" && !empty ? ringChart(m.ring) : null;
  const t = el("article", { cls: "life-tile" + (wide ? " wide" : "") + (empty ? " empty" : ""), title: m.hint, attrs: { tabindex: "0" } },
    el("div", { cls: "life-tile-top" }, el("span", { cls: "life-emoji", attrs: { "aria-hidden": "true" }, textContent: m.emoji }),
      el("div", { cls: "life-tile-name" }, el("strong", { textContent: m.title }), el("small", { textContent: m.hint }))),
    el("div", { cls: "life-value-row" }, el("div", { cls: "life-value", textContent: m.value }), ring),
    m.detail ? el("p", { cls: "life-detail", textContent: m.detail }) : null,
    mini ? el("div", { cls: "life-mini" }, mini) : null,
    wide);
  t.style.setProperty("--i", String(i));
  return t;
}

function render() {
  if (!host) return;
  const refresh = iconButton("refresh", "Пересчитать показатели", () => void load(true), "icon-btn sm" + (loading ? " spin" : ""));
  refresh.disabled = loading;
  const src = data?.source === "git" ? "по истории git" : data?.source === "github" ? "с GitHub" : data?.source === "saved" ? "сохранённая копия" : "";
  const head = el("header", { cls: "life-head" },
    el("div", { cls: "life-head-text" }, el("h2", {}, el("span", { cls: "life-pulse", attrs: { "aria-hidden": "true" } }), "Жизнь проекта"),
      el("p", { textContent: data ? [`${data.commits.toLocaleString("ru-RU")} коммитов`, agoText(data.generatedAt), src].filter(Boolean).join(" · ") : "85 необычных показателей JUUNIBI" })),
    refresh);
  if (!data) {
    host.replaceChildren(head, error
      ? el("div", { cls: "life-empty" }, el("span", { textContent: "🛰️" }), el("p", { textContent: error }))
      : el("div", { cls: "life-skeleton", attrs: { "aria-label": "Загрузка показателей" } }, ...Array.from({ length: 6 }, () => el("i"))));
    return;
  }
  const by = new Map(data.metrics.map((m) => [m.id, m]));
  const highlights = HIGHLIGHTS.map((id) => by.get(id)).filter((m): m is ProjectMetric => !!m);
  const open = readOpen();
  const groups = data.groups.map((g) => {
    const items = data!.metrics.filter((m) => m.group === g.id);
    const d = el("details", { cls: "life-group g-" + g.id, open: open.has(g.id) },
      el("summary", {}, el("span", { cls: "life-group-ic", attrs: { "aria-hidden": "true" }, textContent: GROUP_ICON[g.id] ?? "✨" }),
        el("span", { cls: "grow", textContent: g.title }), el("span", { cls: "life-count", textContent: String(items.length) }), icon("chevron", 16)),
      el("div", { cls: "life-grid" }, ...items.map(tile)));
    d.addEventListener("toggle", () => { const s = readOpen(); if (d.open) s.add(g.id); else s.delete(g.id); saveOpen(s); });
    return d;
  });
  host.replaceChildren(head,
    el("div", { cls: "life-highlights" }, ...highlights.map((m) => el("div", { cls: "life-hl", title: m.hint }, el("span", { textContent: m.emoji }), el("b", { textContent: m.value }), el("small", { textContent: m.title })))),
    ...groups,
    ...(error ? [el("p", { cls: "life-note", textContent: error })] : []));
}

async function load(force = false) {
  if (loading) return;
  loading = true; render();
  const r = await api.projectStats(force);
  loading = false;
  loadedAt = Date.now(); // a failure waits too, the page is redrawn often while an update runs
  if (r.ok) { data = r.value; error = ""; }
  else error = data ? "Не удалось обновить: " + r.error.message : r.error.message;
  render();
}

/** The panel; data is (re)loaded when the page is opened and the figures are older than five minutes. */
export function projectLifePanel(): HTMLElement {
  if (!host) host = el("aside", { cls: "life", attrs: { "aria-label": "Жизнь проекта" } });
  if (!loading && Date.now() - loadedAt > 5 * 60_000) void load(); else if (!host.childElementCount) render();
  return host;
}
