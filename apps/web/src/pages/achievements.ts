/**
 * «Дела и достижения» (#/achievements): the 60 figures with small charts, the collection book of awards
 * (hidden ones as silhouettes with a riddle, medals from bronze to platinum), the twelve tails, the records book,
 * the time machine, discoveries and JUUNIBI's notices, the gallery of rare cards, titles, and the rarity tiers with their effects.
 * The data comes from the server (achievements.ts there); `achData` keeps one copy for this page and the panel on «Дела».
 */
import { api, type AchAward, type AchDay, type AchievementsData, type AchMetric, type AchTail } from "../api";
import { el, icon, iconButton } from "../dom";
import { showToast } from "../toast";
import { celebrate } from "./celebrate";
import { effectFor, filterAwards, galleryAwards, medalPips, nextCelebration, quickDays, safeHex, wrapText, type AwardFilter } from "./achievements-model";
import { btn, chip, emptyState } from "./kit";
import { miniChart, ringChart } from "./life-charts";
import { tailsEmblem } from "./tails";
import "./achievements.css";

// ------------------------------------------------------------------ one copy of the data, shared with the panel
let data: AchievementsData | null = null;
let error = "";
let loading: Promise<void> | null = null;
let loadedAt = 0;
const subs = new Set<() => void>();
export const achData = {
  get: () => data,
  error: () => error,
  /** Reloads (at most every few seconds unless forced) and tells the subscribers. */
  load(force = false): Promise<void> {
    if (loading) return loading;
    if (!force && data && Date.now() - loadedAt < 4000) return Promise.resolve();
    loading = api.achievements().then((r) => {
      loading = null; loadedAt = Date.now();
      if (r.ok) { data = r.value; error = ""; } else error = r.error.message;
      for (const f of [...subs]) f();
    });
    return loading;
  },
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f); },
};
const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const TAB_KEY = "juunibi.ach.tab", OPEN_KEY = "juunibi.ach.open";
const GROUP_COLOR: Record<string, string> = { secret: "#e0a43a", battle: "#ef5b5b", discover: "#8b6cff", treasure: "#22b5c4", legends: "#f2b705", detective: "#6b8afd", space: "#7c5cff", fox: "#f97316", trials: "#ec4899", museum: "#3fbf87", tails: "#fb7185" };
const ruDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const ruShort = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

/** Plays what was won since the last look (the rarest one, with «и ещё N»), then marks all of it seen. */
let celebrating = false;
export function playPending(go?: () => void) {
  const d = data;
  const next = d ? nextCelebration(d.pending) : null;
  if (!d || !next || celebrating) return;
  celebrating = true;
  const tier = d.tiers[next.first.tier];
  const ids = d.pending.map((p) => p.award);
  celebrate({ effect: effectFor(tier, next.first.level), emoji: next.first.emoji, title: next.first.title, tierTitle: tier?.title ?? "", color: safeHex(tier?.color),
    medal: next.first.level > 0 && (d.awards.find((a) => a.id === next.first.award)?.levels ?? 1) > 1 ? d.medals[next.first.level] : undefined, text: next.first.text, more: next.more,
    open: go });
  d.pending = [];
  void api.achievementsSeen(ids).finally(() => { celebrating = false; });
}

// ------------------------------------------------------------------ pieces
export function awardBadge(a: AchAward, d: AchievementsData, small = false): HTMLElement {
  const tier = d.tiers[a.tier];
  const b = el("span", { cls: "ach-badge" + (a.level ? " won" : " locked") + (small ? " sm" : ""), title: a.level ? `${a.title} · ${tier?.title ?? ""}` : a.hidden ? "Тайная награда" : a.title, attrs: { "aria-hidden": "true" } }, a.level || !a.hidden ? a.emoji : "❔");
  b.style.setProperty("--tier", safeHex(tier?.color));
  if (a.level > 1) b.dataset.medal = String(a.level);
  return b;
}
const pips = (a: AchAward) => el("span", { cls: "ach-pips", attrs: { "aria-label": a.level ? `медаль: ${["", "бронза", "серебро", "золото", "платина"][a.level]}` : "ещё не получена" } }, ...medalPips(a).map((s, i) => el("i", { cls: s + " m" + (i + 1) })));

function metricTile(m: AchMetric, a: AchAward | undefined, d: AchievementsData, i: number): HTMLElement {
  const mini = m.ready && m.kind !== "list" ? miniChart(m.kind, m.series, m.labels) : null;
  const ring = typeof m.ring === "number" && m.ready ? ringChart(m.ring) : null;
  const list = m.ready && m.kind === "list" && m.list?.length ? el("ul", { cls: "life-list" }, ...m.list.map((x) => el("li", { cls: x.startsWith("✓") ? "on" : x.startsWith("·") ? "off" : "", textContent: x }))) : null;
  const t = el("article", { cls: "life-tile ach-tile" + (m.ready ? "" : " empty"), title: m.hint, attrs: { tabindex: "0" } },
    el("div", { cls: "life-tile-top" }, el("span", { cls: "life-emoji", attrs: { "aria-hidden": "true" }, textContent: m.emoji }),
      el("div", { cls: "life-tile-name grow" }, el("strong", {}, el("span", { cls: "ach-n", textContent: "#" + m.n }), " " + m.title), el("small", { textContent: m.hint })),
      a ? awardBadge(a, d, true) : null),
    el("div", { cls: "life-value-row" }, el("div", { cls: "life-value", textContent: m.ready ? m.value : "копим данные" }), ring),
    m.detail ? el("p", { cls: "life-detail", textContent: m.ready ? m.detail : m.detail.replace(/^Копим данные: /, "Нужно: ") }) : null,
    mini ? el("div", { cls: "life-mini" }, mini) : null, list);
  t.style.setProperty("--i", String(i));
  return t;
}

function awardCard(a: AchAward, d: AchievementsData, onOpen: (a: AchAward) => void): HTMLElement {
  const tier = d.tiers[a.tier];
  const secret = a.hidden && !a.level;
  const card = el("button", { type: "button", cls: "ach-card" + (a.level ? " won" : "") + (secret ? " secret" : ""), attrs: { "aria-label": secret ? "Тайная награда: " + (a.riddle ?? "") : `${a.title}, ${tier?.title ?? ""}` + (a.level ? ", получена" : ", не получена") } },
    el("div", { cls: "ach-card-top" }, awardBadge(a, d), el("span", { cls: "ach-tier", textContent: (tier?.emoji ?? "") + " " + (tier?.title ?? "") })),
    el("strong", { cls: "ach-card-title", textContent: secret ? "Тайная награда" : a.title }),
    el("small", { cls: "ach-card-goal", textContent: secret ? a.riddle ?? "" : a.level ? (a.firstAt ? "Получена " + ruShort(a.firstAt) : "") + (a.metric ? " · " + a.metric : "") : "Условие: " + a.goal }),
    a.levels > 1 || a.level ? pips(a) : null,
    !a.level && a.progress > 0 && !secret ? el("div", { cls: "ach-progress", attrs: { role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(a.progress * 100)), "aria-label": "До награды" } }, el("i")) : null);
  card.style.setProperty("--tier", safeHex(tier?.color));
  card.style.setProperty("--p", String(Math.round(a.progress * 100)));
  card.addEventListener("click", () => onOpen(a));
  return card;
}

/** A gallery card as a picture to save: drawn on a canvas, downloaded as PNG (works over plain http too). */
function savePicture(a: AchAward, d: AchievementsData) {
  const tier = d.tiers[a.tier]!;
  const c = document.createElement("canvas");
  c.width = 720; c.height = 960;
  const g = c.getContext("2d");
  if (!g) { showToast("Не получилось нарисовать картинку"); return; }
  const col = safeHex(tier.color);
  const bg = g.createLinearGradient(0, 0, 720, 960);
  bg.addColorStop(0, "#14111f"); bg.addColorStop(0.55, "#1d1830"); bg.addColorStop(1, col);
  g.fillStyle = bg; g.fillRect(0, 0, 720, 960);
  const glow = g.createRadialGradient(360, 360, 20, 360, 360, 300);
  glow.addColorStop(0, col + "aa"); glow.addColorStop(1, "transparent");
  g.fillStyle = glow; g.fillRect(0, 0, 720, 720);
  g.strokeStyle = col; g.lineWidth = 6; g.strokeRect(24, 24, 672, 912);
  g.textAlign = "center"; g.fillStyle = "#fff";
  g.font = "200px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
  g.fillText(a.emoji, 360, 430);
  g.font = "600 30px system-ui,sans-serif"; g.fillStyle = col;
  g.fillText(`${tier.emoji} ${tier.title.toUpperCase()}` + (a.level > 1 ? ` · ${d.medals[a.level]!.toUpperCase()}` : ""), 360, 540);
  g.fillStyle = "#fff"; g.font = "700 54px system-ui,sans-serif";
  wrapText(a.title, 20, 2).forEach((l, i) => g.fillText(l, 360, 620 + i * 64));
  g.fillStyle = "#d6d0e6"; g.font = "28px system-ui,sans-serif";
  wrapText(a.goal, 38, 2).forEach((l, i) => g.fillText(l, 360, 760 + i * 38));
  g.fillStyle = "#a59fb8"; g.font = "24px system-ui,sans-serif";
  g.fillText((a.firstAt ? ruDate(a.firstAt) + " · " : "") + "JUUNIBI · Дела и достижения", 360, 890);
  c.toBlob((blob) => {
    if (!blob) { showToast("Не получилось сохранить картинку"); return; }
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: `juunibi-${a.id}.png` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

// ------------------------------------------------------------------ the page
type Tab = "metrics" | "book" | "tails" | "records" | "time" | "discover" | "gallery" | "titles" | "rarity";
const TABS: [Tab, string, string][] = [["metrics", "Показатели", "📊"], ["book", "Книга", "📖"], ["tails", "Хвосты", "🦊"], ["records", "Рекорды", "🏆"], ["time", "Машина времени", "🕰️"], ["discover", "Открытия", "🔮"], ["gallery", "Галерея", "🖼️"], ["titles", "Титулы", "👑"], ["rarity", "Редкость", "✨"]];

export interface AchievementsDeps { back(): void }
export function achievementsPage(deps: AchievementsDeps, startTab?: Tab): HTMLElement {
  let tab: Tab = startTab ?? ((TABS.some(([t]) => t === store.get(TAB_KEY)) ? store.get(TAB_KEY) : "metrics") as Tab);
  const filter: AwardFilter = { tier: null, state: "all", group: null };
  let tail: string | null = null;
  let day = quickDays()[0]!.day;
  let dayData: AchDay | null = null, dayError = "";
  const head = el("header", { cls: "ach-hero" });
  const tabs = el("div", { cls: "ach-tabs", attrs: { role: "tablist", "aria-label": "Разделы коллекции" } });
  const body = el("div", { cls: "ach-body", attrs: { role: "tabpanel" } });
  const root = el("div", { cls: "page ach-page" },
    el("div", { cls: "ach-top" }, el("button", { type: "button", cls: "ach-back", onclick: () => deps.back() }, icon("chevronLeft", 18), "Дела"),
      iconButton("refresh", "Пересчитать", () => void achData.load(true), "icon-btn sm")),
    head, tabs, body);

  const openAward = (a: AchAward) => {
    const d = data!;
    const tier = d.tiers[a.tier]!;
    const secret = a.hidden && !a.level;
    const effect = effectFor(tier, a.level);
    const box = el("div", { cls: "ach-detail" },
      el("p", { textContent: secret ? "Это тайная награда. Подсказка: " + (a.riddle ?? "") : "Условие: " + a.goal + "." }),
      a.level ? el("p", { textContent: `Получена ${ruDate(a.firstAt!)}` + (a.level > 1 ? `, медаль: ${d.medals[a.level]!.toLowerCase()}` : "") + (a.repeat ? `, повторов: ${a.periods}` : "") + "." }) : a.next ? el("p", { textContent: `До бронзы: ${Math.round(a.progress * 100)}%.` }) : null,
      a.level && a.nextGoal ? el("p", { textContent: `Следующая медаль, ${d.medals[a.level + 1]!.toLowerCase()}: ${a.nextGoal} (${Math.round(a.progress * 100)}%).` }) : null,
      a.history.length > 1 ? el("ul", { cls: "ach-hist" }, ...a.history.map((h) => el("li", { textContent: `${ruShort(h.at)} — ${d.medals[h.level] || "получена"}` }))) : null,
      el("p", { cls: "muted small", textContent: `Редкость: ${tier.emoji} ${tier.title} — ${tier.hint.toLowerCase()}. Эффект: ${d.effects.find((e) => e.id === effect)?.title ?? ""}.` }));
    celebrate({ effect, emoji: secret ? "❔" : a.emoji, title: secret ? "Тайная награда" : a.title, tierTitle: tier.title, color: safeHex(tier.color), medal: a.level > 1 ? d.medals[a.level] : undefined, text: box.textContent });
  };

  function renderHead() {
    const d = data;
    if (!d) { head.replaceChildren(el("h1", { textContent: "Дела и достижения" }), el("p", { cls: "muted", textContent: error || "Загрузка…" })); return; }
    const title = d.titles.find((t) => t.id === d.title);
    head.replaceChildren(
      el("div", { cls: "ach-hero-text" },
        el("h1", { textContent: "Дела и достижения" }),
        title ? el("span", { cls: "ach-title-chip", textContent: `${title.emoji} ${title.title}` }) : null,
        el("p", { cls: "muted", textContent: "60 необычных показателей ваших дел, награды двенадцати уровней редкости и хвосты, которые растут вместе с вами." }),
        el("div", { cls: "ach-stats" },
          ...([[d.stats.won + " / " + d.stats.total, "наград"], [String(d.stats.rare), "редких"], [String(d.stats.medals), "ступеней медалей"], [d.stats.ready + " / 60", "показателей"], [String(d.tails.filter((t) => t.level).length) + " / 12", "хвостов"]] as const)
            .map(([v, l]) => el("div", { cls: "ach-stat" }, el("b", { textContent: v }), el("span", { textContent: l })))),
        el("p", { cls: "ach-surprise" }, el("span", { attrs: { "aria-hidden": "true" }, textContent: d.surprise.emoji }), el("span", {}, el("b", { textContent: "Сюрприз дня. " }), d.surprise.text))),
      el("div", { cls: "ach-hero-tails" }, tailsEmblem(d.tails, { size: "lg", onPick: (t) => { tail = t.id; setTab("tails"); } })));
  }
  function setTab(t: Tab) { tab = t; store.set(TAB_KEY, t); renderTabs(); renderBody(); }
  function renderTabs() {
    tabs.replaceChildren(...TABS.map(([t, label, e]) => {
      const b = el("button", { type: "button", cls: "ach-tab", attrs: { role: "tab", "aria-selected": String(tab === t) } }, el("span", { attrs: { "aria-hidden": "true" }, textContent: e }), label);
      b.addEventListener("click", () => setTab(t));
      return b;
    }));
  }

  function renderBody() {
    const d = data;
    if (!d) { body.replaceChildren(error ? emptyState("alert", "Не удалось загрузить", error, btn("Повторить", () => void achData.load(true), { small: true })) : el("div", { cls: "life-skeleton" }, ...Array.from({ length: 6 }, () => el("i")))); return; }
    const award = (id: string) => d.awards.find((a) => a.id === id);
    if (tab === "metrics") {
      const open = new Set((store.get(OPEN_KEY) ?? "secret,battle").split(","));
      body.replaceChildren(...d.groups.map((g) => {
        const items = d.metrics.filter((m) => m.group === g.id);
        const won = items.filter((m) => (award(m.id)?.level ?? 0) > 0).length;
        const det = el("details", { cls: "life-group ach-group", open: open.has(g.id) },
          el("summary", {}, el("span", { cls: "life-group-ic", attrs: { "aria-hidden": "true" }, textContent: g.emoji }), el("span", { cls: "grow", textContent: g.title }),
            el("span", { cls: "ach-range", textContent: `№${items[0]?.n}–${items[items.length - 1]?.n}` }), el("span", { cls: "life-count", textContent: `${won}/${items.length}` }), icon("chevron", 16)),
          el("div", { cls: "life-grid ach-grid" }, ...items.map((m, i) => metricTile(m, award(m.id), d, i))));
        det.style.setProperty("--g", GROUP_COLOR[g.id] ?? "#e0a43a");
        det.addEventListener("toggle", () => { const s = new Set((store.get(OPEN_KEY) ?? "secret,battle").split(",")); if (det.open) s.add(g.id); else s.delete(g.id); store.set(OPEN_KEY, [...s].join(",")); });
        return det;
      }));
      return;
    }
    if (tab === "book") {
      const groups = [...d.groups, { id: "tails", emoji: "🦊", title: "Хвосты" }];
      const tierSel = el("select", { cls: "mem-select", attrs: { "aria-label": "Редкость" } }, el("option", { value: "", textContent: "Любая редкость" }),
        ...d.tiers.map((t, i) => el("option", { value: String(i), textContent: `${t.emoji} ${t.title} · ${d.awards.filter((a) => a.tier === i).length}` })));
      tierSel.value = filter.tier === null ? "" : String(filter.tier);
      tierSel.addEventListener("change", () => { filter.tier = tierSel.value === "" ? null : Number(tierSel.value); renderBody(); });
      const groupSel = el("select", { cls: "mem-select", attrs: { "aria-label": "Группа" } }, el("option", { value: "", textContent: "Все группы" }), ...groups.map((g) => el("option", { value: g.id, textContent: g.emoji + " " + g.title })));
      groupSel.value = filter.group ?? "";
      groupSel.addEventListener("change", () => { filter.group = groupSel.value || null; renderBody(); });
      const bar = el("div", { cls: "ach-filters" },
        el("div", { cls: "chips" }, ...([["all", "Все"], ["won", "Полученные"], ["locked", "Ещё впереди"]] as const).map(([s, l]) => chip(l, s === "all" ? d.awards.length : s === "won" ? d.stats.won : d.awards.length - d.stats.won, filter.state === s, () => { filter.state = s; renderBody(); }))),
        tierSel, groupSel);
      const list = filterAwards(d.awards, filter);
      body.replaceChildren(el("p", { cls: "muted small", textContent: "Коллекционная книга: все награды с датой получения. Тайные показаны силуэтом с подсказкой. Медали растут: бронза → серебро → золото → платина. Нажмите на награду — покажу её эффект." }),
        bar, list.length ? el("div", { cls: "ach-cards" }, ...list.map((a) => awardCard(a, d, openAward))) : emptyState("search", "Таких наград нет", "Измените фильтр."));
      return;
    }
    if (tab === "tails") {
      const sel = d.tails.find((t) => t.id === tail) ?? null;
      const row = (t: AchTail) => {
        const r = el("button", { type: "button", cls: "ach-tail-row" + (t.id === tail ? " sel" : "") + (t.level ? "" : " sleep") },
          el("span", { cls: "ach-tail-ic", attrs: { "aria-hidden": "true" }, textContent: t.emoji }),
          el("span", { cls: "grow" }, el("b", { textContent: t.title }), el("small", { textContent: ` · ${t.pattern}` }),
            el("span", { cls: "ach-tail-bar" }, el("i")), el("small", { cls: "muted", textContent: t.next ? `Сделано ${t.done}; до узора «${["Спит", "Искра", "Узор", "Сияние", "Пламя", "Звёздный узор"][t.level + 1]}» ещё ${t.next - t.done}` : `Сделано ${t.done}: высший узор` })),
          el("span", { cls: "ach-tail-next", attrs: { "aria-label": t.next ? `Прогресс ${Math.round(t.progress * 100)} процентов, до следующего уровня ${Math.max(0, t.next - t.done)} дел` : "Максимальный уровень" } }, el("span", { textContent: t.next ? "↗" : "★" }), el("small", { textContent: t.next ? `${Math.round(t.progress * 100)}%` : "MAX" })),
          el("span", { cls: "ach-tail-lv", textContent: String(t.level) }));
        r.style.setProperty("--p", String(Math.round(t.progress * 100)));
        r.addEventListener("click", () => { tail = t.id; renderBody(); });
        return r;
      };
      body.replaceChildren(el("div", { cls: "ach-tails" },
        el("div", { cls: "ach-tails-art" }, tailsEmblem(d.tails, { size: "lg", selected: tail ?? undefined, onPick: (t) => { tail = t.id; renderBody(); } }),
          el("p", { cls: "muted small", textContent: sel ? `${sel.emoji} ${sel.title}: ${sel.pattern}. Хвост растёт от дел этого направления — по словам в тексте, проекту, повтору и тому, как дело сделано.` : "Каждый хвост — отдельное направление. По мере настоящих дел хвосты получают узоры: искра, узор, сияние, пламя и звёздный узор. Нажмите на хвост." })),
        el("div", { cls: "ach-tail-list" }, ...d.tails.map(row))));
      return;
    }
    if (tab === "records") {
      body.replaceChildren(d.records.length ? el("div", { cls: "ach-records" }, ...d.records.map((r) => el("article", { cls: "pg-card ach-record" },
        el("div", { cls: "ach-record-top" }, el("span", { cls: "life-emoji", textContent: r.emoji }), el("strong", { cls: "grow", textContent: r.title }), el("b", { cls: "ach-record-best", textContent: r.best.label })),
        el("p", { cls: "small muted", textContent: r.best.text + " · " + ruDate(r.best.at) }),
        r.history.length > 1 ? el("ol", { cls: "ach-record-hist" }, ...r.history.slice(1).map((h) => el("li", {}, el("span", { textContent: h.label }), el("small", { textContent: ruShort(h.at) + (h.first ? " · первая запись" : "") })))) : el("p", { cls: "small muted", textContent: "Первая запись. Когда рекорд побьют, эта останется в истории." }))))
        : emptyState("trophy", "Рекордов пока нет", "Они появятся сами, по мере дел."));
      return;
    }
    if (tab === "time") {
      const input = el("input", { type: "date", cls: "mem-select", value: day, max: quickDays()[0]!.day, attrs: { "aria-label": "День" } });
      input.addEventListener("change", () => { if (input.value) { day = input.value; void loadDay(); } });
      const shift = (n: number) => { const t = new Date(day + "T12:00"); t.setDate(t.getDate() + n); const k = t.toISOString().slice(0, 10); if (n > 0 && dayData?.next === null) return; day = k; void loadDay(); };
      const KIND: Record<string, string> = { add: "➕", done: "✅", move: "↪️", remove: "🍂", edit: "✏️", undone: "↩️", note: "📝", award: "🏅", notice: "🦊" };
      body.replaceChildren(el("div", { cls: "ach-time" },
        el("div", { cls: "ach-time-bar" }, iconButton("chevronLeft", "День раньше", () => shift(-1), "icon-btn sm"), input, iconButton("chevronRight", "День позже", () => shift(1), "icon-btn sm"),
          ...quickDays().map((q) => btn(q.label, () => { day = q.day; void loadDay(); }, { small: true }))),
        dayError ? el("p", { cls: "muted", textContent: dayError }) : !dayData ? el("p", { cls: "muted", textContent: "Загрузка…" }) : el("article", { cls: "pg-card ach-day" },
          el("h2", { textContent: dayData.date }),
          el("p", { cls: "ach-story", textContent: dayData.story }),
          el("div", { cls: "ach-day-counts" }, ...([["✅", dayData.counts.done, "сделано"], ["➕", dayData.counts.added, "добавлено"], ["📝", dayData.counts.notes, "заметок"], ["↪️", dayData.counts.moved, "переносов"], ["🏅", dayData.counts.awards, "наград"]] as const).map(([e, n, l]) => el("span", { cls: n ? "" : "zero" }, e + " ", el("b", { textContent: String(n) }), " " + l))),
          dayData.lines.length ? el("ol", { cls: "ach-day-lines" }, ...dayData.lines.map((l) => el("li", { cls: "k-" + l.kind }, el("time", { textContent: l.time }), el("span", { attrs: { "aria-hidden": "true" }, textContent: KIND[l.kind] ?? "•" }), el("span", { textContent: l.text })))) : null)));
      if (!dayData || dayData.day !== day) void loadDay();
      return;
    }
    if (tab === "discover") {
      body.replaceChildren(el("div", { cls: "ach-discover" },
        el("article", { cls: "pg-card ach-surprise-card" }, el("span", { cls: "ach-big", textContent: d.surprise.emoji }), el("div", {}, el("h2", { textContent: "Сюрприз дня" }), el("p", { textContent: d.surprise.text }), el("small", { cls: "muted", textContent: "JUUNIBI выбирает один необычный факт в день; завтра будет другой." }))),
        el("article", { cls: "pg-card" }, el("h2", { textContent: "Маленькие открытия JUUNIBI" }),
          d.discoveries.length ? el("ul", { cls: "ach-finds" }, ...d.discoveries.map((x) => el("li", { textContent: x }))) : el("p", { cls: "muted", textContent: "Закономерности появятся, когда выполненных дел станет больше (нужно хотя бы по 4–5 в разных направлениях)." }),
          el("small", { cls: "muted", textContent: "Это наблюдения о делах, а не оценка личности." })),
        el("article", { cls: "pg-card" }, el("h2", { textContent: "JUUNIBI замечает" }),
          d.notices.length ? el("ul", { cls: "ach-notices" }, ...d.notices.slice(0, 25).map((n) => el("li", {}, el("span", { cls: "ach-n-ic", textContent: n.emoji }), el("span", { cls: "grow", textContent: n.text }), el("time", { textContent: ruShort(n.at) })))) : el("p", { cls: "muted", textContent: "Пока тихо. Я замечу, когда случится что-то интересное." }))));
      return;
    }
    if (tab === "gallery") {
      const g = galleryAwards(d);
      body.replaceChildren(el("p", { cls: "muted small", textContent: "Редкие награды (эпические и выше) оформлены карточками. Карточку можно сохранить картинкой." }),
        g.length ? el("div", { cls: "ach-gallery" }, ...g.map((a) => {
          const tier = d.tiers[a.tier]!;
          const c = el("article", { cls: "ach-gal" },
            el("div", { cls: "ach-gal-art", attrs: { "aria-hidden": "true" } }, el("span", { textContent: a.emoji })),
            el("span", { cls: "ach-tier", textContent: `${tier.emoji} ${tier.title}` + (a.level > 1 ? ` · ${d.medals[a.level]}` : "") }),
            el("strong", { textContent: a.title }), el("small", { textContent: a.goal }), el("small", { cls: "muted", textContent: a.firstAt ? ruDate(a.firstAt) : "" }),
            el("div", { cls: "row" }, btn("Эффект", () => openAward(a), { small: true, icon: "sparkle" }), btn("Сохранить картинку", () => savePicture(a, d), { small: true, icon: "download" })));
          c.style.setProperty("--tier", safeHex(tier.color));
          return c;
        })) : emptyState("trophy", "Галерея пока пуста", "Здесь появятся эпические, героические и ещё более редкие награды."));
      return;
    }
    if (tab === "titles") {
      body.replaceChildren(el("p", { cls: "muted small", textContent: "Особенные титулы даются за сочетания наград. Выбранный титул виден под приветствием на «Делах»." }),
        el("div", { cls: "ach-titles" }, ...d.titles.map((t) => {
          const on = d.title === t.id;
          const b = el("button", { type: "button", cls: "ach-title" + (t.at ? " won" : "") + (on ? " on" : ""), disabled: !t.at, attrs: { "aria-pressed": String(on) } },
            el("span", { cls: "ach-big", textContent: t.at ? t.emoji : "🔒" }), el("strong", { textContent: t.title }), el("small", { textContent: t.at ? (on ? "Выбран · " : "Получен ") + ruShort(t.at) : "Как получить: " + t.how }));
          b.addEventListener("click", async () => {
            const r = await api.achievementTitle(on ? null : t.id);
            if (!r.ok) { showToast(r.error.message); return; }
            if (data) data.title = r.value.title;
            showToast(r.value.title ? `Титул «${t.title}» выбран` : "Титул снят", { ms: 2500 });
            renderHead(); renderBody();
          });
          return b;
        })));
      return;
    }
    // rarity and effects
    let shown = store.get("juunibi.ach.tier");
    const tierIx = Math.min(11, Math.max(0, Number(shown ?? 6) || 0));
    const t = d.tiers[tierIx]!;
    const detail = el("article", { cls: "ach-tier-detail" },
      el("span", { cls: "ach-big", textContent: t.emoji }), el("div", { cls: "grow" }, el("strong", { textContent: t.title }), el("p", { textContent: t.hint }),
        el("p", { cls: "small", textContent: "Эффекты: " + t.effects.map((e) => d.effects.find((x) => x.id === e)?.title).join(" и ") + " (второй — при улучшении медали)." }),
        el("p", { cls: "small muted", textContent: `Наград этой редкости: ${d.awards.filter((a) => a.tier === tierIx).length}, получено: ${d.awards.filter((a) => a.tier === tierIx && a.level).length}.` })),
      btn("Показать эффект", () => celebrate({ effect: t.effects[0], emoji: t.emoji, title: t.title, tierTitle: "Пример эффекта", color: safeHex(t.color), text: t.hint }), { small: true, icon: "play" }));
    detail.style.setProperty("--tier", safeHex(t.color));
    const families: [string, string][] = [["magic", "✨ Магические"], ["fox", "🦊 Лисьи"], ["ceremony", "🏆 Торжественные"], ["legend", "🌌 Легендарные"]];
    body.replaceChildren(
      el("h2", { cls: "ach-h2", textContent: "Двенадцать уровней редкости" }),
      el("p", { cls: "muted small", textContent: "Нажмите на уровень, чтобы увидеть его эффект и условия." }),
      el("div", { cls: "ach-tiers" }, ...d.tiers.map((x, i) => {
        const b = el("button", { type: "button", cls: "ach-tier-btn" + (i === tierIx ? " on" : ""), attrs: { "aria-pressed": String(i === tierIx) } }, el("span", { textContent: x.emoji }), el("small", { textContent: x.title }));
        b.style.setProperty("--tier", safeHex(x.color));
        b.addEventListener("click", () => { shown = String(i); store.set("juunibi.ach.tier", shown); renderBody(); });
        return b;
      })),
      detail,
      el("h2", { cls: "ach-h2", textContent: "24 особенные анимации" }),
      el("div", { cls: "ach-effects" }, ...families.map(([f, title]) => el("section", { cls: "ach-fx-group" }, el("h3", { textContent: title }),
        el("div", { cls: "ach-fx-grid" }, ...d.effects.filter((e) => e.family === f).map((e) => {
          const owner = d.tiers.find((x) => x.effects.includes(e.id));
          const b = el("button", { type: "button", cls: "ach-fx", title: owner ? "Редкость: " + owner.title : "" }, el("span", { textContent: e.emoji }), el("small", { textContent: e.title }));
          b.addEventListener("click", () => celebrate({ effect: e.id, emoji: e.emoji, title: e.title, tierTitle: owner?.title ?? "", color: safeHex(owner?.color), text: owner ? `Так празднуются награды редкости «${owner.title}».` : null }));
          return b;
        }))))));
  }
  async function loadDay() {
    dayError = "";
    const want = day;
    const r = await api.achievementDay(want);
    if (want !== day) return;
    if (r.ok) dayData = r.value; else { dayData = null; dayError = r.error.message; }
    if (tab === "time") renderBody();
  }
  const draw = () => { if (!root.isConnected && data) { stop(); return; } renderHead(); renderTabs(); renderBody(); playPending(); };
  const stop = achData.subscribe(draw);
  renderHead(); renderTabs(); renderBody();
  void achData.load(true);
  return root;
}
