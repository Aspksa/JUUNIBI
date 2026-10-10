/**
 * Small charts of «Жизнь проекта»: every tile carries one (a line, bars, a ring of a share, a split bar,
 * dots or colour swatches). One series per chart, drawn in the group's colour; names stay on hover.
 */
import { el } from "../dom";

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const num = (n: number) => Math.round(n).toLocaleString("ru-RU");

/** Points of a line chart in a 100×32 box; the top keeps 2 units of air, one value becomes a flat line. */
export function linePoints(series: number[], w = 100, h = 32): [number, number][] {
  const s = series.length === 1 ? [series[0]!, series[0]!] : series;
  if (!s.length) return [];
  const min = Math.min(0, ...s), max = Math.max(...s);
  const range = max - min || 1;
  return s.map((v, i) => [Math.round((i / (s.length - 1)) * w * 100) / 100, Math.round((h - ((v - min) / range) * (h - 2)) * 100) / 100]);
}

/** Parts of a split bar with their share in whole percent (the biggest keeps the rounding rest). */
export function splitParts(series: number[], labels: string[] = []): { label: string; value: number; pct: number }[] {
  const sum = series.reduce((a, b) => a + Math.max(0, b), 0);
  if (!sum) return [];
  const parts = series.map((v, i) => ({ label: labels[i] ?? String(i + 1), value: Math.max(0, v), pct: Math.round((100 * Math.max(0, v)) / sum) }));
  return parts.filter((p) => p.value > 0);
}

/** Only plain hex colours from the statistics may reach a style attribute. */
export const safeColor = (c: string): string | null => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : null);

function line(series: number[]): Element {
  const pts = linePoints(series);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const box = svg("svg", { viewBox: "0 0 100 32", preserveAspectRatio: "none", class: "life-line", role: "img", "aria-label": `от ${num(series[0] ?? 0)} до ${num(series[series.length - 1] ?? 0)}` });
  const title = svg("title", {});
  title.textContent = `было ${num(series[0] ?? 0)}, стало ${num(series[series.length - 1] ?? 0)}`;
  box.append(title, svg("path", { d: `${d} L100 32 L0 32 Z`, class: "area" }), svg("path", { d, class: "stroke" }));
  return box;
}

function bars(series: number[], labels: string[] | undefined, cls: string): HTMLElement {
  const max = Math.max(1, ...series);
  return el("div", { cls: "life-bars " + cls, attrs: { "aria-hidden": "true" } },
    ...series.map((v, i) => {
      const b = el("i", { title: labels?.[i] ? `${labels[i]}: ${num(v)}` : num(v) });
      b.style.setProperty("--h", String(Math.max(4, Math.round((100 * v) / max))));
      b.style.setProperty("--d", String(i));
      return b;
    }));
}

function split(series: number[], labels?: string[]): HTMLElement {
  const parts = splitParts(series, labels);
  if (!parts.length) return el("div", { cls: "life-split" }, el("div", { cls: "life-split-bar empty" }), el("div", { cls: "life-split-legend", textContent: "пока пусто" }));
  const bar = el("div", { cls: "life-split-bar" }, ...parts.map((p, i) => {
    const seg = el("i", { title: `${p.label}: ${num(p.value)} (${p.pct}%)` });
    seg.style.flexGrow = String(p.value);
    seg.style.setProperty("--o", String([1, 0.72, 0.5, 0.34, 0.22][i] ?? 0.16));
    return seg;
  }));
  const legend = el("div", { cls: "life-split-legend" }, ...parts.slice(0, 3).map((p, i) => {
    const key = el("span", {}, el("b", { attrs: { "aria-hidden": "true" } }), `${p.label} ${p.pct}%`);
    key.style.setProperty("--o", String([1, 0.72, 0.5][i]));
    return key;
  }));
  return el("div", { cls: "life-split" }, bar, legend);
}

function dots(n: number): HTMLElement {
  const shown = Math.min(48, Math.max(0, Math.round(n)));
  const box = el("div", { cls: "life-dots", attrs: { "aria-hidden": "true" } }, ...Array.from({ length: shown }, (_, i) => {
    const d = el("i");
    d.style.setProperty("--d", String(i));
    return d;
  }));
  if (n > shown) box.append(el("small", { textContent: `+${num(n - shown)}` }));
  if (!shown) box.append(el("small", { textContent: "пока пусто" }));
  return box;
}

function swatches(list: string[]): HTMLElement {
  return el("div", { cls: "life-swatches" }, ...list.map(safeColor).filter((c): c is string => !!c).map((c) => {
    const s = el("i", { title: c });
    s.style.background = c;
    return s;
  }));
}

/** A ring of a share (0…1) with the percent inside. */
export function ringChart(share: number): Element {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100);
  const box = svg("svg", { viewBox: "0 0 36 36", class: "life-ring", role: "img", "aria-label": `${pct}%` });
  box.append(svg("circle", { cx: 18, cy: 18, r: 15.5, class: "track", pathLength: 100 }),
    svg("circle", { cx: 18, cy: 18, r: 15.5, class: "fill", pathLength: 100, "stroke-dasharray": `${pct} 100`, transform: "rotate(-90 18 18)" }));
  const t = svg("text", { x: 18, y: 18, "text-anchor": "middle", "dominant-baseline": "central" });
  t.textContent = pct + "%";
  box.append(t);
  return box;
}

/** The chart under a tile's value, or null when the tile has none (hours, calendar and lists are drawn by the panel). */
export function miniChart(kind: string | undefined, series: number[] | undefined, labels?: string[], list?: string[]): Element | null {
  if (kind === "swatches" && list?.length) return swatches(list);
  if (!series?.length) return null;
  if (kind === "line") return series.length > 1 || series[0] ? line(series) : null;
  if (kind === "spark") return bars(series, labels, "life-bars-mini");
  if (kind === "split") return split(series, labels);
  if (kind === "dots") return dots(series[0] ?? 0);
  return null;
}

export { bars as barChart };
