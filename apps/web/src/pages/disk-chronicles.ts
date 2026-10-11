/** «Хроники Диска»: the hundred figures, grouped by their own group, in the app's theme. */
import { api, type DiskChronicles } from "../api";
import { el } from "../dom";
import { showToast } from "../toast";
import { dIcon } from "./disk-icons";
import { human } from "./disk-model";
import { openSheet } from "./sheet";

type Metric = DiskChronicles["metrics"][number];

/** Groups in their order, each with its metrics: ready ones first, those without data last. */
export function chronicleSections(data: DiskChronicles): { id: string; title: string; metrics: Metric[] }[] {
  return data.groups.map((g) => ({
    id: g.id, title: g.title,
    metrics: data.metrics.filter((m) => m.group === g.id).sort((a, b) => Number(b.ready) - Number(a.ready)),
  })).filter((s) => s.metrics.length);
}
/** Two or three short figures for a closed group: the first ready metrics with short values. */
export function keyFigures(metrics: Metric[], n = 3): Metric[] {
  return metrics.filter((m) => m.ready && m.value.length <= 18 && !/^Нет/.test(m.value)).slice(0, n);
}

export async function openChronicles(): Promise<void> {
  const r = await api.diskChronicles();
  if (!r.ok) { showToast(r.error.message); return; }
  const data = r.value;
  const fig = (value: string, label: string) => el("div", { cls: "dkc-fig" }, el("strong", { textContent: value }), el("span", { textContent: label }));
  const top = el("div", { cls: "dkc-top" },
    fig(String(data.summary.files), "файлов"), fig(human(data.summary.bytes), "занято"),
    fig(String(data.summary.folders), "папок"), fig(data.summary.ready + " из " + data.summary.total, "показателей рассчитано"));
  const q = el("input", { type: "search", cls: "mem-input dkc-search", placeholder: "Найти показатель", attrs: { "aria-label": "Найти показатель" } });
  const list = el("div", { cls: "dkc-groups" });
  const sections = chronicleSections(data);
  const tile = (m: Metric) => el("div", { cls: "dkc-tile" + (m.ready ? "" : " no-data"), title: m.ready ? "" : m.reason ?? "" },
    el("span", { cls: "dkc-name", textContent: m.title }),
    el("strong", { cls: "dkc-value", textContent: m.ready ? m.value : "Нет данных" }));
  const draw = () => {
    const text = q.value.trim().toLocaleLowerCase();
    list.replaceChildren(...sections.flatMap((s, i) => {
      const found = text ? s.metrics.filter((m) => m.title.toLocaleLowerCase().includes(text)) : s.metrics;
      if (!found.length) return [];
      const box = el("details", { cls: "dkc-group", open: !!text || i === 0 });
      const keys = keyFigures(s.metrics);
      const ready = s.metrics.filter((m) => m.ready).length;
      box.append(el("summary", {},
        el("span", { cls: "dkc-gtitle" }, dIcon("chevronRight", 16), el("b", { textContent: s.title }), el("small", { cls: "muted", textContent: ready + " из " + s.metrics.length })),
        el("span", { cls: "dkc-keys" }, ...keys.map((m) => el("span", { title: m.title }, el("b", { textContent: m.value }), " " + shortTitle(m.title))))));
      const tiles = el("div", { cls: "dkc-tiles" });
      const fill = () => { if (!tiles.childElementCount) tiles.append(...found.map(tile)); };
      if (box.open) fill();
      box.addEventListener("toggle", () => { if (box.open) fill(); });
      box.append(tiles);
      return [box];
    }));
    if (!list.childElementCount) list.append(el("p", { cls: "muted dkc-none", textContent: "Такого показателя нет." }));
  };
  q.addEventListener("input", draw);
  draw();
  const content = el("div", { cls: "dkc" }, top, q, list);
  openSheet({ title: "Хроники Диска", icon: "sparkle", sub: data.summary.total + " показателей о ваших файлах. Всё считается на этом компьютере.", content });
  content.closest(".mod-sheet")?.classList.add("dkc-sheet");
}
/** «Количество активных файлов» → «активных файлов»: a short tail for the closed group line. */
function shortTitle(title: string): string {
  const t = title.replace(/^(Количество|Число|Доля|Размер|Объём|Средн\S*|Медианн\S*)\s+/i, "");
  return t.length > 26 ? t.slice(0, 25).trimEnd() + "…" : (/^\p{Lu}\p{Ll}/u.test(t) ? t.charAt(0).toLocaleLowerCase() + t.slice(1) : t);
}
