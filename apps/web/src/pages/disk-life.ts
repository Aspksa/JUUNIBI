/**
 * «Жизнь документов»: 150 figures about the Disk (counted on this computer by the server, see
 * apps/server/src/disk-life.ts), drawn like «Жизнь проекта»: big highlights on top, then one group at a time,
 * each figure a tile with its own two-tone glyph and a small chart. No inner scrollbars: the page scrolls.
 */
import { api, type DiskLife, type DiskLifeMetric } from "../api";
import { el, icon, iconButton } from "../dom";
import { lifeGlyph } from "./disk-life-icons";
import { barChart, miniChart, ringChart } from "./life-charts";
import { agoText } from "./project-life";

const GROUP_KEY = "juunibi.disk.life.group";
const HOURS_LABEL = ["0", "6", "12", "18", "23"];
const low = (s: string) => s.toLocaleLowerCase("ru-RU");

/** Figures whose title, hint or group name has the query; an empty query keeps them all. */
export function findMetrics(metrics: DiskLifeMetric[], groups: { id: string; title: string }[], query: string): DiskLifeMetric[] {
  const q = low(query.trim());
  if (!q) return metrics;
  const title = new Map(groups.map((g) => [g.id, low(g.title)]));
  return metrics.filter((m) => low(m.title).includes(q) || low(m.hint).includes(q) || (title.get(m.group) ?? "").includes(q));
}
/** How many figures of a group have something to show. */
export const readyIn = (metrics: DiskLifeMetric[], group: string) => metrics.filter((m) => m.group === group && !m.empty).length;

const store = {
  get: () => { try { return localStorage.getItem(GROUP_KEY) ?? ""; } catch { return ""; } },
  set: (v: string) => { try { localStorage.setItem(GROUP_KEY, v); } catch { /* private mode */ } },
};

/** Twelve weeks of uploads as a heat grid, Monday on top. */
function heat(series: number[]): HTMLElement {
  const max = Math.max(1, ...series);
  return el("div", { cls: "life-heat dkl-heat", attrs: { "aria-hidden": "true" } }, ...series.map((v, i) => {
    const c = el("i", { title: `${v}` });
    c.style.setProperty("--a", v ? String(0.25 + (0.75 * v) / max) : "0");
    c.style.setProperty("--d", String(i));
    return c;
  }));
}

function chart(m: DiskLifeMetric): Element | null {
  if (m.empty) return null;
  if (m.kind === "hours" && m.series) return el("div", {}, barChart(m.series, m.series.map((_, h) => `${h}:00`), "dkl-hours"), el("div", { cls: "life-axis" }, ...HOURS_LABEL.map((x) => el("span", { textContent: x }))));
  if (m.kind === "calendar" && m.series) return heat(m.series);
  if (m.kind === "list") return m.list?.length ? el("ul", { cls: "life-list" }, ...m.list.map((x) => el("li", { textContent: x }))) : null;
  if (m.kind === "swatches" && !m.list?.length) return null;
  if ((m.kind === "spark" || m.kind === "line") && m.series && !m.series.some(Boolean)) return el("div", { cls: "dkl-flat", textContent: "пока ровно" });
  return miniChart(m.kind, m.series, m.labels, m.list);
}

function tile(m: DiskLifeMetric, color: string, i: number, groupTitle?: string): HTMLElement {
  const ring = typeof m.ring === "number" && !m.empty ? ringChart(m.ring) : null;
  const c = chart(m);
  const t = el("article", { cls: "dkl-tile" + (m.empty ? " is-empty" : ""), title: m.hint, attrs: { tabindex: "0", "data-id": m.id } },
    el("div", { cls: "dkl-tile-top" },
      el("span", { cls: "dkl-ic" }, lifeGlyph(m.icon, m.group, 22)),
      el("div", { cls: "dkl-name" }, el("strong", { textContent: m.title }), el("small", { textContent: groupTitle ? `${groupTitle} · ${m.hint}` : m.hint }))),
    el("div", { cls: "dkl-value-row" }, el("div", { cls: "dkl-value", textContent: m.value }), ring),
    m.detail && !m.empty ? el("p", { cls: "dkl-detail", textContent: m.detail }) : null,
    c ? el("div", { cls: "dkl-chart" }, c) : null);
  t.style.setProperty("--g", color);
  t.style.setProperty("--i", String(i));
  return t;
}

export function diskLifePanel(): { root: HTMLElement; refresh: () => void; reveal: () => void } {
  const root = el("section", { cls: "dkl", attrs: { id: "disk-life", "aria-label": "Жизнь документов" } });
  let data: DiskLife | null = null, error = "", loading = false, stale = true, visible = false, timer = 0;
  let group = store.get();
  const search = el("input", { type: "search", cls: "dkl-search-input", placeholder: "Найти показатель…", attrs: { "aria-label": "Найти показатель" } }) as HTMLInputElement;
  const searchBox = el("label", { cls: "dkl-search" }, icon("search", 16), search);
  const body = el("div", { cls: "dkl-body" });
  const sub = el("p", { cls: "dkl-sub" });
  const refreshBtn = iconButton("refresh", "Пересчитать показатели", () => void load(), "icon-btn dkl-refresh");
  const head = el("header", { cls: "dkl-head" },
    el("span", { cls: "dkl-mark" }, lifeGlyph("pulse", "core", 26)),
    el("div", { cls: "dkl-title" }, el("h2", {}, "Жизнь документов", el("span", { cls: "life-pulse", attrs: { "aria-hidden": "true" } })), sub),
    searchBox, refreshBtn);
  root.append(head, body);

  const color = (id: string) => data?.groups.find((g) => g.id === id)?.color ?? "var(--brand)";
  function flash(id: string) {
    const t = body.querySelector<HTMLElement>(`.dkl-tile[data-id="${CSS.escape(id)}"]`);
    if (!t) return;
    t.scrollIntoView({ block: "nearest", behavior: "smooth" });
    t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash");
    t.focus({ preventScroll: true });
  }

  function render() {
    refreshBtn.classList.toggle("spin", loading);
    refreshBtn.disabled = loading;
    if (!data) {
      sub.textContent = "150 показателей · только реальные данные";
      body.replaceChildren(error
        ? el("div", { cls: "life-empty dkl-empty" }, el("span", {}, icon("alert", 26)), el("p", { textContent: error }))
        : el("div", { cls: "dkl-skeleton", attrs: { "aria-label": "Считаю показатели" } }, ...Array.from({ length: 10 }, () => el("i"))));
      return;
    }
    const d = data;
    const a = d.analysis;
    sub.textContent = [
      `${d.metrics.length} показателей · только реальные данные`,
      agoText(d.generatedAt),
      a.documents ? `прочитано ${a.read} из ${a.documents} документов` : "",
      a.images ? `измерено ${a.measured} из ${a.images} снимков` : "",
    ].filter(Boolean).join(" · ");
    if (!d.groups.some((g) => g.id === group)) group = d.groups[0]!.id;
    const query = search.value;
    const byId = new Map(d.metrics.map((m) => [m.id, m]));
    const hl = el("div", { cls: "dkl-hl" }, ...d.highlights.map((id) => byId.get(id)).filter((m): m is DiskLifeMetric => !!m).map((m, i) => {
      const g = d.groups.find((x) => x.id === m.group)!;
      const c = m.empty ? null : m.kind && m.kind !== "list" ? miniChart(m.kind, m.series, m.labels, m.list) : typeof m.ring === "number" ? ringChart(m.ring) : null;
      const card = el("button", { type: "button", cls: "dkl-hl-card" + (m.empty ? " is-empty" : ""), title: `${m.hint} — открыть «${g.title}»` },
        el("span", { cls: "dkl-ic" }, lifeGlyph(m.icon, m.group, 22)),
        el("b", { textContent: m.value }), el("small", { textContent: m.title }),
        c ? el("span", { cls: "dkl-hl-chart" }, c) : null);
      card.style.setProperty("--g", g.color);
      card.style.setProperty("--i", String(i));
      card.addEventListener("click", () => { search.value = ""; group = m.group; store.set(group); render(); flash(m.id); });
      return card;
    }));
    if (query.trim()) {
      const found = findMetrics(d.metrics, d.groups, query);
      const titles = new Map(d.groups.map((g) => [g.id, g.title]));
      body.replaceChildren(hl,
        el("div", { cls: "dkl-group-head" }, el("h3", { textContent: found.length ? `Найдено: ${found.length}` : "Ничего не нашлось" }), el("p", { textContent: found.length ? "по названию, подсказке и группе" : "Попробуйте другое слово" })),
        el("div", { cls: "dkl-grid" }, ...found.map((m, i) => tile(m, color(m.group), i, titles.get(m.group)))));
      return;
    }
    const tabs = el("div", { cls: "dkl-tabs", attrs: { role: "tablist", "aria-label": "Группы показателей" } }, ...d.groups.map((g) => {
      const ready = readyIn(d.metrics, g.id), total = d.metrics.filter((m) => m.group === g.id).length;
      const b = el("button", { type: "button", cls: "dkl-tab", attrs: { role: "tab", "aria-selected": String(g.id === group), title: `${g.title}: ${g.note} · ${ready} из ${total}` } },
        el("span", { cls: "dkl-ic sm" }, lifeGlyph(g.icon, g.id, 18)),
        el("span", { cls: "dkl-tab-text" }, el("b", { textContent: g.title }), el("small", { textContent: `${ready} из ${total}` })),
        el("i", { cls: "dkl-tab-bar", attrs: { "aria-hidden": "true" } }));
      b.style.setProperty("--g", g.color);
      b.style.setProperty("--p", String(total ? Math.round((100 * ready) / total) : 0));
      b.addEventListener("click", () => { group = g.id; store.set(group); render(); });
      return b;
    }));
    tabs.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = d.groups.findIndex((g) => g.id === group), n = d.groups.length;
      group = d.groups[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n]!.id; store.set(group); render();
      root.querySelector<HTMLElement>('.dkl-tab[aria-selected="true"]')?.focus();
    });
    const g = d.groups.find((x) => x.id === group)!;
    const items = d.metrics.filter((m) => m.group === g.id);
    const gh = el("div", { cls: "dkl-group-head" }, el("span", { cls: "dkl-ic lg" }, lifeGlyph(g.icon, g.id, 26)), el("div", {}, el("h3", { textContent: g.title }), el("p", { textContent: g.note })));
    gh.style.setProperty("--g", g.color);
    body.replaceChildren(hl, tabs, gh, el("div", { cls: "dkl-grid" }, ...items.map((m, i) => tile(m, g.color, i))));
  }

  async function load() {
    if (loading) return;
    loading = true; stale = false; render();
    const r = await api.diskLife();
    loading = false;
    if (r.ok && r.value.groups?.length) { data = r.value; error = ""; }
    else error = data ? "" : "Не удалось посчитать: " + (r.ok ? "пустой ответ" : r.error.message);
    render();
  }
  let searchTimer = 0;
  search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 120); });
  // figures are counted only when the block is on screen, and again after the catalogue changes
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible && stale) void load(); }, { rootMargin: "300px" }) : null;
  if (io) io.observe(root); else visible = true;
  render();
  return {
    root,
    refresh: () => { stale = true; clearTimeout(timer); if (visible) timer = window.setTimeout(() => void load(), data ? 1200 : 0); },
    reveal: () => { root.scrollIntoView({ behavior: "smooth", block: "start" }); if (stale) void load(); },
  };
}
