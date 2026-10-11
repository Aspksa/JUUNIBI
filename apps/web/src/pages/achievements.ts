/**
 * «Дела и достижения» (#/achievements): the 60 figures with small charts, the collection book of awards
 * (hidden ones as silhouettes with a riddle, medals from bronze to platinum), the twelve tails, the records book,
 * the time machine, discoveries and JUUNIBI's notices, the gallery of rare cards, titles, and the rarity tiers with their effects.
 * The data comes from the server (achievements.ts there); `achData` keeps one copy for this page and the panel on «Дела».
 */
import { api, type AchAward, type AchDay, type AchievementsData, type AchMetric, type AchTail } from "../api";
import { el, icon, iconButton, settleAnimations } from "../dom";
import { showToast } from "../toast";
import { celebrate } from "./celebrate";
import { FOX_PATH, effectFor, filterAwards, foxPath, freshCount, galleryAwards, medalPips, needText, nextCelebration, nextSteps, quickDays, rarityOf, safeHex, sameData, wrapText, type AwardFilter } from "./achievements-model";
import { plural } from "./brain-model";
import { btn, chip, emptyState } from "./kit";
import { miniChart, ringChart } from "./life-charts";
import { kitsuneUrl, tailsEmblem } from "./tails";
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
      // nothing changed since the last count: no redraw, so the page never blinks or stutters
      if (r.ok && !error && sameData(data, r.value)) return;
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
const TAB_KEY = "juunibi.ach.tab", GROUP_KEY = "juunibi.ach.group", SOUND_KEY = "juunibi.ach.sound";
/** A short bell for a new award (only when the owner turned the sound on): more notes for a rarer award. Web Audio works over plain http. */
export function chime(tier: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const notes = [659.3, 784, 987.8, 1318.5, 1568, 1975.5].slice(0, 3 + Math.min(3, Math.floor(tier / 4)));
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.11;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.95);
    });
    setTimeout(() => void ac.close(), 2200);
  } catch { /* no sound here */ }
}
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
  if (store.get(SOUND_KEY) === "1") chime(next.first.tier);
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
  const secret = a.hidden && !a.level;
  const b = el("span", { cls: "ach-badge" + (a.level ? " won" : " locked") + (secret ? " secret" : "") + (small ? " sm" : ""), title: a.level ? `${a.title} · ${tier?.title ?? ""}` : secret ? "Тайная награда" : a.title, attrs: { "aria-hidden": "true" } }, secret ? "?" : a.emoji);
  b.style.setProperty("--tier", safeHex(tier?.color));
  if (a.level > 1) b.dataset.medal = String(a.level);
  return b;
}
const pips = (a: AchAward) => el("span", { cls: "ach-pips", attrs: { "aria-label": a.level ? `медаль: ${["", "бронза", "серебро", "золото", "платина"][a.level]}` : "ещё не получена" } }, ...medalPips(a).map((s, i) => el("i", { cls: s + " m" + (i + 1) })));

function metricTile(m: AchMetric, a: AchAward | undefined, d: AchievementsData, i: number): HTMLElement {
  // a figure still collecting data is a quiet «fog» card: what it is and the one thing it needs
  if (!m.ready) {
    const t = el("article", { cls: "ach-fog", title: m.hint, attrs: { tabindex: "0" } },
      el("span", { cls: "ach-fog-ic", attrs: { "aria-hidden": "true" }, textContent: m.emoji }),
      el("div", { cls: "ach-fog-text" }, el("strong", {}, el("span", { cls: "ach-n", textContent: "#" + m.n }), " " + m.title), el("small", { textContent: needText(m.detail) })),
      el("span", { cls: "ach-fog-lock", attrs: { "aria-hidden": "true" } }, icon("lock", 14)));
    t.style.setProperty("--i", String(i));
    return t;
  }
  const flat = !m.series?.some((x) => x > 0);
  const mini = m.kind && m.kind !== "list" && !flat ? miniChart(m.kind, m.series, m.labels) : null;
  const ring = typeof m.ring === "number" ? ringChart(m.ring) : null;
  const list = m.kind === "list" && m.list?.length ? el("ul", { cls: "life-list" }, ...m.list.map((x) => el("li", { cls: x.startsWith("✓") ? "on" : x.startsWith("·") ? "off" : "", textContent: x }))) : null;
  const t = el("article", { cls: "life-tile ach-tile", title: m.hint, attrs: { tabindex: "0" } },
    el("div", { cls: "life-tile-top" }, el("span", { cls: "life-emoji", attrs: { "aria-hidden": "true" }, textContent: m.emoji }),
      el("div", { cls: "life-tile-name grow" }, el("strong", {}, el("span", { cls: "ach-n", textContent: "#" + m.n }), " " + m.title), el("small", { textContent: m.hint })),
      a ? awardBadge(a, d, true) : null),
    el("div", { cls: "life-value-row" }, el("div", { cls: "life-value", textContent: m.value }), ring),
    m.detail ? el("p", { cls: "life-detail", textContent: m.detail }) : null,
    mini ? el("div", { cls: "life-mini" }, mini) : null, list);
  if (a?.level) { t.dataset.rarity = rarityOf(a.tier); t.style.setProperty("--tier", safeHex(d.tiers[a.tier]?.color)); }
  t.style.setProperty("--i", String(i));
  return t;
}

function awardCard(a: AchAward, d: AchievementsData, onOpen: (a: AchAward) => void): HTMLElement {
  const tier = d.tiers[a.tier];
  const secret = a.hidden && !a.level;
  const card = el("button", { type: "button", cls: "ach-card" + (a.level ? " won" : "") + (secret ? " secret" : "") + (a.group === "season" ? " season " + a.id : ""), attrs: { "aria-label": secret ? "Тайная награда: " + (a.riddle ?? "") : `${a.title}, ${tier?.title ?? ""}` + (a.level ? ", получена" : ", не получена") } },
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

/** «Карточка недели»: the last seven days as a picture with the kitsune, saved as PNG (canvas works over plain http). */
function saveWeekCard(d: AchievementsData) {
  const w = d.week;
  const img = new Image();
  img.onerror = () => showToast("Не получилось нарисовать карточку");
  img.onload = () => {
    const W = 1080, H = 1350;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    if (!g) { showToast("Не получилось нарисовать карточку"); return; }
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1c0e22"); bg.addColorStop(0.6, "#160a17"); bg.addColorStop(1, "#2a0d1f");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // the picture across the top, fading into the night
    const ih = Math.round(W * img.naturalHeight / img.naturalWidth);
    g.drawImage(img, 0, 0, W, ih);
    const fade = g.createLinearGradient(0, ih * 0.55, 0, ih);
    fade.addColorStop(0, "rgba(22,10,23,0)"); fade.addColorStop(1, "#160a17");
    g.fillStyle = fade; g.fillRect(0, ih * 0.55, W, ih * 0.45 + 2);
    g.textAlign = "center";
    g.fillStyle = "#f2b65a"; g.font = "700 28px system-ui,sans-serif";
    g.fillText("НЕДЕЛЯ JUUNIBI", W / 2, 700);
    g.fillStyle = "#fff"; g.font = "800 150px system-ui,sans-serif";
    g.fillText(String(w.done), W / 2, 850);
    g.fillStyle = "#e9dfe8"; g.font = "500 34px system-ui,sans-serif";
    g.fillText(`${plural(w.done, ["дело сделано", "дела сделано", "дел сделано"])} · ${new Date(w.from + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} — ${new Date(w.to + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`, W / 2, 905);
    // seven bars, one per day
    const max = Math.max(1, ...w.perDay), bw = 84, gap = 30, x0 = (W - (7 * bw + 6 * gap)) / 2, base = 1130;
    w.perDay.forEach((v, i) => {
      const h = Math.max(6, Math.round((v / max) * 150)), x = x0 + i * (bw + gap);
      const bar = g.createLinearGradient(0, base - h, 0, base);
      bar.addColorStop(0, "#ffd98a"); bar.addColorStop(1, "#e3501f");
      g.fillStyle = v ? bar : "rgba(255,255,255,.12)";
      g.beginPath(); g.roundRect(x, base - h, bw, h, 14); g.fill();
      g.fillStyle = "#cbb9c8"; g.font = "500 24px system-ui,sans-serif"; g.fillText(w.labels[i] ?? "", x + bw / 2, base + 36);
    });
    g.fillStyle = "#d9cbd6"; g.font = "500 28px system-ui,sans-serif";
    const facts = [`➕ добавлено: ${w.added}`, `🦊 хвостов: ${w.awake} из 12`, ...(w.bestDay ? [`🏆 лучший день: ${w.bestDay.label} (${w.bestDay.count})`] : []), ...(w.topTail ? [`${w.topTail.emoji} главное: ${w.topTail.title.toLowerCase()}`] : [])];
    g.fillText(facts.slice(0, 2).join("   ·   "), W / 2, 1230);
    if (facts.length > 2) g.fillText(facts.slice(2).join("   ·   "), W / 2, 1272);
    g.fillStyle = "#8f7d8c"; g.font = "22px system-ui,sans-serif";
    g.fillText(w.awards.length ? "Награды недели: " + wrapText(w.awards.join(", "), 70, 1)[0] : "JUUNIBI · Дела и достижения", W / 2, 1318);
    c.toBlob((blob) => {
      if (!blob) { showToast("Не получилось сохранить карточку"); return; }
      const url = URL.createObjectURL(blob);
      const link = el("a", { href: url, download: `juunibi-week-${w.to}.png` });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast("Карточка недели сохранена", { ms: 2500 });
    }, "image/png");
  };
  img.src = kitsuneUrl;
}

// ------------------------------------------------------------------ the page
type Tab = "metrics" | "book" | "tails" | "records" | "time" | "discover" | "gallery" | "titles" | "rarity";
const SEEN_KEY = "juunibi.ach.seen.";
const TABS: [Tab, string, string][] = [["metrics", "Показатели", "📊"], ["book", "Книга", "📖"], ["tails", "Хвосты", "🦊"], ["records", "Рекорды", "🏆"], ["time", "Машина времени", "🕰️"], ["discover", "Открытия", "🔮"], ["gallery", "Галерея", "🖼️"], ["titles", "Титулы", "👑"], ["rarity", "Редкость", "✨"]];

export interface AchievementsDeps { back(): void }
export function achievementsPage(deps: AchievementsDeps, startTab?: Tab): HTMLElement {
  let tab: Tab = startTab ?? ((TABS.some(([t]) => t === store.get(TAB_KEY)) ? store.get(TAB_KEY) : "metrics") as Tab);
  const filter: AwardFilter = { tier: null, state: "all", group: null };
  let tail: string | null = null;
  let metricGroup: string | null = store.get(GROUP_KEY) || null;
  let metricShow: "all" | "ready" | "wait" = "all";
  let rendered = false;
  let day = quickDays()[0]!.day;
  let dayData: AchDay | null = null, dayError = "";
  const head = el("header", { cls: "ach-hero" });
  const extras = el("section", { cls: "ach-extras", attrs: { "aria-label": "Путь, шаги и задание дня" } });
  const tabs = el("div", { cls: "ach-tabs", attrs: { role: "tablist", "aria-label": "Разделы коллекции" } });
  const body = el("div", { cls: "ach-body", attrs: { role: "tabpanel" } });
  const root = el("div", { cls: "page ach-page" },
    el("div", { cls: "ach-top" }, el("button", { type: "button", cls: "ach-back", onclick: () => deps.back() }, icon("chevronLeft", 18), "Дела"),
      iconButton("refresh", "Пересчитать", () => void achData.load(true), "icon-btn sm")),
    head, extras, tabs, body);

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
    celebrate({ effect, emoji: secret ? "❔" : a.emoji, title: secret ? "Тайная награда" : a.title, tierTitle: tier.title, color: safeHex(tier.color), medal: a.level > 1 ? d.medals[a.level] : undefined, text: [...box.children].map((x) => x.textContent ?? "").join(" ") });
  };

  function renderHead() {
    const d = data;
    if (!d) { head.replaceChildren(el("div", { cls: "ach-hero-text" }, el("h1", { textContent: "Дела и достижения" }), el("p", { cls: "muted", textContent: error || "Загрузка…" }))); extras.replaceChildren(); return; }
    const title = d.titles.find((t) => t.id === d.title);
    const awake = d.tails.filter((t) => t.level).length;
    const share = d.stats.total ? d.stats.won / d.stats.total : 0;
    const bar = el("div", { cls: "ach-hero-progress", attrs: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(d.stats.total), "aria-valuenow": String(d.stats.won), "aria-label": "Собрано наград" } }, el("i"));
    bar.style.setProperty("--p", String(Math.round(share * 100)));
    const surpriseEmoji = d.surprise.emoji === "🦊" ? "✨" : d.surprise.emoji;
    const medal = (v: string, l: string, e: string) => el("div", { cls: "ach-stat" }, el("span", { cls: "ach-stat-ic", attrs: { "aria-hidden": "true" }, textContent: e }), el("b", { textContent: v }), el("span", { textContent: l }));
    const sound = store.get(SOUND_KEY) === "1";
    head.replaceChildren(
      el("div", { cls: "ach-hero-text" },
        el("span", { cls: "ach-eyebrow", textContent: "Коллекция JUUNIBI" }),
        el("h1", { textContent: "Дела и достижения" }),
        title ? el("span", { cls: "ach-title-chip", textContent: `${title.emoji} ${title.title}` }) : null,
        el("p", { cls: "ach-hero-lead", textContent: "60 необычных показателей ваших дел, награды двенадцати уровней редкости и кицунэ, чьи хвосты просыпаются вместе с вашими делами." }),
        el("div", { cls: "ach-hero-collected" }, el("span", {}, el("b", { textContent: String(d.stats.won) }), ` из ${d.stats.total} наград собрано`), el("small", { textContent: `${Math.round(share * 100)}%` })),
        bar,
        el("div", { cls: "ach-stats" }, medal(String(d.stats.rare), "редких наград", "💎"), medal(String(d.stats.medals), "ступеней медалей", "🏅"), medal(`${d.stats.ready}/60`, "показателей считается", "📊"), medal(`${awake}/12`, "хвостов проснулось", "🦊")),
        el("div", { cls: "ach-surprise" }, el("span", { cls: "ach-surprise-ic", attrs: { "aria-hidden": "true" }, textContent: surpriseEmoji }), el("p", {}, el("b", { textContent: "Сюрприз дня" }), el("span", { textContent: d.surprise.text }))),
        el("div", { cls: "ach-hero-actions" },
          btn("Карточка недели", () => saveWeekCard(d), { small: true, icon: "download" }),
          btn(sound ? "Звук наград: вкл." : "Звук наград: выкл.", () => { store.set(SOUND_KEY, sound ? "0" : "1"); renderHead(); if (!sound) chime(6); }, { small: true, icon: sound ? "bell" : "bellOff" }))),
      el("div", { cls: "ach-hero-tails" }, tailsEmblem(d.tails, { size: "lg", onPick: (t) => { tail = t.id; setTab("tails"); } }),
        el("p", { cls: "ach-hero-cap" }, el("b", { textContent: awake ? `Проснулось хвостов: ${awake} из 12` : "Кицунэ спит" }),
          el("small", { textContent: awake === 12 ? "Все двенадцать горят, и её сила достаёт до города." : "Нажмите на хвост, чтобы узнать его направление." }))));
    renderExtras(d);
  }
  /** «Путь кицунэ», the three next steps and today's task. */
  function renderExtras(d: AchievementsData) {
    const path = foxPath(d.stats.medals);
    const cur = FOX_PATH[path.index]!;
    const track = el("ol", { cls: "ach-path-track" }, ...FOX_PATH.map((s, i) => {
      const li = el("li", { cls: i < path.index ? "past" : i === path.index ? "now" : "", title: `${s.title}: от ${s.at} ${plural(s.at, ["ступени", "ступеней", "ступеней"])} медалей` },
        el("span", { cls: "ach-path-dot", attrs: { "aria-hidden": "true" }, textContent: s.emoji }), el("small", { textContent: s.title }));
      if (i === path.index) li.setAttribute("aria-current", "step");
      return li;
    }));
    const pathBar = el("span", { cls: "ach-path-bar", attrs: { "aria-hidden": "true" } }, el("i"));
    pathBar.style.setProperty("--p", String(Math.round(path.progress * 100)));
    const pathCard = el("article", { cls: "ach-path" },
      el("div", { cls: "ach-path-head" },
        el("div", {}, el("span", { cls: "ach-eyebrow", textContent: "Путь кицунэ" }), el("h2", { textContent: `${cur.emoji} ${cur.title}` })),
        el("small", { textContent: path.next ? `До «${path.next.title}»: ещё ${path.next.at - d.stats.medals} ${plural(path.next.at - d.stats.medals, ["ступень", "ступени", "ступеней"])} медалей` : "Высшая ступень пути" })),
      pathBar, track);
    const steps = nextSteps(d.metrics);
    const stepsCard = el("article", { cls: "ach-steps" },
      el("span", { cls: "ach-eyebrow", textContent: "Следующие шаги" }),
      steps.length ? el("ol", {}, ...steps.map((s) => el("li", { title: s.titles.join(", ") },
        el("span", { cls: "ach-step-ic", attrs: { "aria-hidden": "true" }, textContent: s.emoji }),
        el("span", { cls: "grow" }, el("b", { textContent: s.text }), el("small", { textContent: `оживит ${s.count} ${plural(s.count, ["показатель", "показателя", "показателей"])}` })))))
        : el("p", { cls: "muted small", textContent: "Все показатели уже считаются. Остаётся собирать медали." }),
      btn("К делам", () => deps.back(), { small: true, icon: "chevronLeft" }));
    const q = d.quest;
    const questCard = el("article", { cls: "ach-quest" + (q?.done ? " done" : "") },
      el("div", { cls: "ach-quest-head" }, el("span", { cls: "ach-eyebrow", textContent: "Задание дня" }), el("span", { cls: "ach-sparks", title: "Искры за выполненные задания", textContent: `✨ ${d.sparks}` })),
      q ? el("p", { cls: "ach-quest-text" }, el("span", { cls: "ach-quest-ic", attrs: { "aria-hidden": "true" }, textContent: q.done ? "✅" : q.emoji }), el("span", { textContent: q.done ? `Выполнено: «${q.title}» сдвинулся. Завтра будет новое задание.` : q.text }))
        : el("p", { cls: "muted small", textContent: "Задание появится завтра утром." }),
      el("small", { cls: "muted", textContent: "За каждое выполненное задание — искра." }));
    extras.replaceChildren(pathCard, el("div", { cls: "ach-extras-row" }, stepsCard, questCard));
  }
  function setTab(t: Tab) { tab = t; store.set(TAB_KEY, t); renderTabs(); renderBody(); }
  function renderTabs() {
    const d = data;
    if (d) {
      // the open tab is seen now; a tab never visited starts from now, so it does not greet with everything as «new»
      for (const [t] of TABS) if (t === tab || !store.get(SEEN_KEY + t)) store.set(SEEN_KEY + t, d.generatedAt);
    }
    tabs.replaceChildren(...TABS.map(([t, label, e]) => {
      const fresh = d && t !== tab ? freshCount(d, t, store.get(SEEN_KEY + t)) : 0;
      const b = el("button", { type: "button", cls: "ach-tab", attrs: { role: "tab", "aria-selected": String(tab === t), "aria-label": label + (fresh ? `, новых: ${fresh}` : "") } },
        el("span", { cls: "ach-tab-ic", attrs: { "aria-hidden": "true" }, textContent: e }), el("span", { cls: "ach-tab-label", textContent: label }),
        fresh ? el("span", { cls: "ach-tab-new", attrs: { "aria-hidden": "true" }, textContent: fresh > 9 ? "9+" : String(fresh) }) : null);
      b.addEventListener("click", () => setTab(t));
      return b;
    }));
  }

  function renderBody() {
    const d = data;
    if (!d) { body.replaceChildren(error ? emptyState("alert", "Не удалось загрузить", error, btn("Повторить", () => void achData.load(true), { small: true })) : el("div", { cls: "life-skeleton" }, ...Array.from({ length: 6 }, () => el("i")))); return; }
    const award = (id: string) => d.awards.find((a) => a.id === id);
    if (tab === "metrics") {
      const ready = d.metrics.filter((m) => m.ready).length;
      if (metricGroup && !d.groups.some((g) => g.id === metricGroup)) metricGroup = null;
      const pickGroup = (g: string | null) => { metricGroup = g; store.set(GROUP_KEY, g ?? ""); renderBody(); };
      const pickShow = (v: typeof metricShow) => { metricShow = v; renderBody(); };
      const groups = d.groups.filter((g) => !metricGroup || g.id === metricGroup);
      const nav = el("div", { cls: "ach-filters ach-metric-filters" },
        el("div", { cls: "chips" }, ...([["all", "Все", d.metrics.length], ["ready", "Считаются", ready], ["wait", "Копят данные", d.metrics.length - ready]] as const)
          .map(([v, l, n]) => chip(l, n, metricShow === v, () => pickShow(v)))),
        el("div", { cls: "ach-group-nav", attrs: { role: "group", "aria-label": "Группы показателей" } },
          ...[{ id: "", emoji: "🗂️", title: "Все группы" }, ...d.groups].map((g) => {
            const b = el("button", { type: "button", cls: "ach-group-pill", attrs: { "aria-pressed": String((metricGroup ?? "") === g.id) }, title: g.title }, el("span", { attrs: { "aria-hidden": "true" }, textContent: g.emoji }), el("span", { textContent: g.title }));
            b.style.setProperty("--g", GROUP_COLOR[g.id] ?? "#e0a43a");
            b.addEventListener("click", () => pickGroup(g.id || null));
            return b;
          })));
      // on a phone the ten groups are a list to pick from rather than a wall of pills
      const groupSel = el("select", { cls: "mem-select ach-group-select", attrs: { "aria-label": "Группа показателей" } },
        el("option", { value: "", textContent: "🗂️ Все группы" }), ...d.groups.map((g) => el("option", { value: g.id, textContent: `${g.emoji} ${g.title}` })));
      groupSel.value = metricGroup ?? "";
      groupSel.addEventListener("change", () => pickGroup(groupSel.value || null));
      nav.append(groupSel);
      const sections = groups.map((g) => {
        const all = d.metrics.filter((m) => m.group === g.id);
        const items = all.filter((m) => metricShow === "all" || (metricShow === "ready" ? m.ready : !m.ready));
        if (!items.length) return null;
        const won = all.filter((m) => (award(m.id)?.level ?? 0) > 0).length;
        const counted = all.filter((m) => m.ready).length;
        // figures that count come first; the ones still collecting data sit below as quiet fog cards
        const live = items.filter((m) => m.ready), fog = items.filter((m) => !m.ready);
        const ring = el("span", { cls: "ach-group-ring", title: `Считается ${counted} из ${all.length}` }, ringChart(counted / Math.max(1, all.length)), el("b", { textContent: `${counted}/${all.length}` }));
        const sec = el("section", { cls: "ach-group" + (counted === all.length ? " complete" : ""), attrs: { "aria-label": g.title } },
          el("header", { cls: "ach-group-head" }, el("span", { cls: "life-group-ic", attrs: { "aria-hidden": "true" }, textContent: g.emoji }),
            el("div", { cls: "grow" }, el("h2", { textContent: g.title }), el("small", { textContent: `№${all[0]?.n}–${all[all.length - 1]?.n} · наград ${won} из ${all.length}` + (counted === all.length ? " · группа собрана" : "") })),
            counted === all.length ? el("span", { cls: "ach-group-seal", title: "Все показатели группы считаются", textContent: "🏵️" }) : null, ring),
          live.length ? el("div", { cls: "ach-grid" }, ...live.map((m, i) => metricTile(m, award(m.id), d, i))) : null,
          fog.length ? el("div", { cls: "ach-fog-wrap" }, el("small", { cls: "ach-fog-label", textContent: `Копят данные · ${fog.length}` }), el("div", { cls: "ach-fog-grid" }, ...fog.map((m, i) => metricTile(m, award(m.id), d, live.length + i)))) : null);
        sec.style.setProperty("--g", GROUP_COLOR[g.id] ?? "#e0a43a");
        return sec;
      }).filter((x): x is HTMLElement => !!x);
      body.replaceChildren(nav, ...(sections.length ? sections : [emptyState("search", "Здесь пока пусто", "Измените фильтр.")]));
      if (rendered) settleAnimations(body);
      rendered = true;
      return;
    }
    if (tab === "book") {
      const groups = [...d.groups, { id: "tails", emoji: "🦊", title: "Хвосты" }, { id: "season", emoji: "🍁", title: "Сезоны" }];
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
      body.replaceChildren(el("p", { cls: "muted small", textContent: "Коллекционная книга: все награды с датой получения. Тайные показаны силуэтом с подсказкой. Медали растут: бронза → серебро → золото → платина. Сезонные награды можно получать каждый год заново. Нажмите на награду, и я покажу её эффект." }),
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
