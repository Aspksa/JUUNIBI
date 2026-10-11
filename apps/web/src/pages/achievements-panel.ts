/**
 * The left column of «Дела»: «Дела и достижения» in short — the kitsune with her twelve tails, the chosen title,
 * the surprise of the day, what JUUNIBI noticed, a few figures, the newest awards and the way into the whole collection.
 * New awards are celebrated here as soon as they come; new notices come as a toast.
 */
import { el, icon, type IconName } from "../dom";
import { showToast } from "../toast";
import { achData, awardBadge, playPending } from "./achievements";
import { freshNotices, needText } from "./achievements-model";
import { tailsEmblem } from "./tails";

const SEEN = "juunibi.ach.noticeSeen";
/** The panel folded down to its title, so the left column of «Дела» stays short (remembered in the browser). */
const FOLDED = "juunibi.ach.panelFolded";
const HIGHLIGHTS = ["keeper", "octopus", "planner", "twelve"];
const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export interface AchPanel { el: HTMLElement; refresh(): void; title(): string | null }
export function achievementsPanel(o: { open(tab?: string): void; onTitle?: () => void }): AchPanel {
  const host = el("section", { cls: "pg-card tasks-side-card ach-panel", attrs: { "aria-label": "Дела и достижения" } });
  let lastTitle: string | null = null;
  let folded = store.get(FOLDED) === "1";
  const render = () => {
    const d = achData.get();
    host.classList.toggle("folded", folded);
    const fold = el("button", { type: "button", cls: "icon-btn sm ach-panel-fold", title: folded ? "Развернуть" : "Свернуть", attrs: { "aria-expanded": String(!folded), "aria-label": folded ? "Развернуть панель достижений" : "Свернуть панель достижений" } }, icon("chevron", 16));
    fold.addEventListener("click", () => { folded = !folded; store.set(FOLDED, folded ? "1" : ""); render(); });
    const head = el("div", { cls: "ach-panel-head" },
      el("button", { type: "button", cls: "ach-panel-open", onclick: () => o.open() }, el("span", { textContent: "Дела и достижения" }), icon("chevronRight", 16)),
      d && folded ? el("small", { cls: "muted ach-panel-mini", textContent: `${d.stats.won}/${d.stats.total} наград` }) : null,
      fold);
    if (!d) { host.replaceChildren(head, el("p", { cls: "muted small", textContent: achData.error() ? "Не удалось загрузить: " + achData.error() : "Считаю показатели…" })); return; }
    const title = d.titles.find((t) => t.id === d.title);
    const t = title ? `${title.emoji} ${title.title}` : null;
    if (t !== lastTitle) { lastTitle = t; o.onTitle?.(); }
    const awake = d.tails.filter((x) => x.level).length;
    const won = d.awards.filter((a) => a.level > 0).sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "")).slice(0, 6);

    const stat = (v: string, l: string) => el("div", { cls: "ach-panel-stat" }, el("b", { textContent: v }), el("span", { textContent: l }));
    const tile = (id: string) => {
      const m = d.metrics.find((x) => x.id === id);
      if (!m) return null;
      const a = d.awards.find((x) => x.id === id);
      const b = el("button", { type: "button", cls: "ach-mini" + (m.ready ? "" : " waiting"), title: m.hint + (m.ready ? "" : ". " + needText(m.detail)) },
        el("span", { cls: "ach-mini-top" }, el("span", { cls: "ach-mini-ic", attrs: { "aria-hidden": "true" }, textContent: m.emoji }), el("small", { textContent: m.title })),
        el("b", { textContent: m.ready ? m.value : "копим данные" }),
        el("span", { cls: "ach-mini-bar", attrs: { "aria-hidden": "true" } }, el("i")));
      b.style.setProperty("--p", String(Math.round((a?.level ? 1 : a?.progress ?? 0) * 100)));
      b.addEventListener("click", () => o.open("metrics"));
      return b;
    };
    const action = (label: string, ic: IconName, tab: string) => el("button", { type: "button", cls: "ach-panel-act", onclick: () => o.open(tab) }, icon(ic, 18), el("span", { textContent: label }));
    const notices = d.notices.slice(0, 2);

    host.replaceChildren(...([head,
      el("button", { type: "button", cls: "ach-panel-scene" + (awake ? "" : " asleep"), title: "Двенадцать хвостов достижений", onclick: () => o.open("tails") },
        tailsEmblem(d.tails),
        el("span", { cls: "ach-panel-scene-cap" },
          el("b", { textContent: awake ? `Проснулось хвостов: ${awake} из 12` : "Кицунэ спит" }),
          el("small", { textContent: awake === 12 ? "Её сила достаёт до города" : awake ? "Каждое направление дел будит свой хвост" : "Хвосты проснутся с первыми сделанными делами" }))),
      el("div", { cls: "ach-panel-stats" }, stat(`${d.stats.won}/${d.stats.total}`, "наград"), stat(String(d.stats.rare), "редких"), stat(String(d.sparks), "искр")),
      el("div", { cls: "ach-panel-surprise" }, el("span", { cls: "ach-panel-surprise-ic", attrs: { "aria-hidden": "true" } }, icon("sparkle", 18)),
        el("p", {}, el("b", { textContent: "Сюрприз дня" }), el("span", { textContent: d.surprise.text }))),
      d.quest ? el("button", { type: "button", cls: "ach-panel-quest" + (d.quest.done ? " done" : ""), onclick: () => o.open("metrics") },
        el("span", { cls: "ach-panel-quest-ic", attrs: { "aria-hidden": "true" } }, icon(d.quest.done ? "circleCheck" : "target", 18)),
        el("span", {}, el("b", { textContent: d.quest.done ? "Задание дня выполнено" : "Задание дня" }), el("small", { textContent: d.quest.done ? `Искр: ${d.sparks}` : d.quest.text }))) : null,
      notices.length ? el("ul", { cls: "ach-panel-notices", attrs: { "aria-label": "JUUNIBI замечает" } }, ...notices.map((n) => el("li", {}, el("span", { cls: "ach-panel-notice-ic", attrs: { "aria-hidden": "true" }, textContent: n.emoji }), el("span", { textContent: n.text })))) : null,
      el("div", { cls: "ach-minis" }, ...HIGHLIGHTS.map(tile).filter((x): x is HTMLButtonElement => !!x)),
      won.length ? el("div", { cls: "ach-panel-badges", attrs: { "aria-label": "Новые награды" } }, ...won.map((a) => { const b = awardBadge(a, d, true); b.removeAttribute("aria-hidden"); b.setAttribute("role", "img"); b.setAttribute("aria-label", a.title); return b; })) : null,
      el("div", { cls: "ach-panel-actions" }, action("Коллекция", "trophy", "book"), action("Рекорды", "star", "records"), action("Машина времени", "clock", "time"))] as (HTMLElement | null)[]).filter((x): x is HTMLElement => !!x));
    // what JUUNIBI noticed since the last look (an award has its own celebration)
    const fresh = freshNotices(d.notices, store.get(SEEN)).filter((n) => n.kind !== "award");
    if (d.notices[0]) store.set(SEEN, d.notices[0].at);
    if (fresh[0] && store.get(SEEN + ".init")) showToast(`${fresh[0].emoji} ${fresh[0].text}`, { ms: 7000, action: { label: "Открыть", run: () => o.open("discover") } });
    store.set(SEEN + ".init", "1");
    playPending(() => o.open("book"));
  };
  const stop = achData.subscribe(() => { if (!host.isConnected && achData.get()) { stop(); return; } render(); });
  render();
  // «Дела» calls refresh() after each load of its list, so the first count comes with it
  return { el: host, refresh: () => void achData.load(true), title: () => lastTitle };
}
