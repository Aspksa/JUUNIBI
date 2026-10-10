/**
 * «Двенадцать хвостов достижений»: JUUNIBI's twelve tails fanned behind her, one per direction of to-dos.
 * A tail that has not woken up is a faint outline; with progress it gets colour, then stripes («Узор»),
 * a glow («Сияние»), a flame at the tip («Пламя») and stars («Звёздный узор»).
 */
import type { AchTail } from "../api";

const SVG = "http://www.w3.org/2000/svg";
const node = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
/** One hue per tail, around the colour wheel from warm to cool. */
export const TAIL_HUES = [28, 44, 58, 96, 140, 168, 190, 212, 248, 278, 312, 345];
/** The angle of tail `i` of `n` in degrees: a fan from −78° to +78° (0 is straight up). */
export const tailAngle = (i: number, n = 12) => -78 + (156 * i) / Math.max(1, n - 1);
const TAIL = "M0 0 C-15 -26 -21 -62 -9 -96 C-4 -110 4 -112 8 -100 C20 -64 14 -26 0 0Z";

let uid = 0;
export function tailsEmblem(tails: AchTail[], o: { size?: "sm" | "lg"; onPick?: (t: AchTail) => void; selected?: string | undefined } = {}): SVGSVGElement {
  const svg = node("svg", { viewBox: "0 0 260 170", class: "tails-svg " + (o.size ?? "sm"), role: "img", "aria-label": `Двенадцать хвостов: проснулось ${tails.filter((t) => t.level).length} из 12` });
  const defs = node("defs");
  const id = `t${++uid}`;
  const glow = node("filter", { id: id + "-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
  glow.append(node("feGaussianBlur", { stdDeviation: 3.2, result: "b" }));
  const merge = node("feMerge");
  merge.append(node("feMergeNode", { in: "b" }), node("feMergeNode", { in: "SourceGraphic" }));
  glow.append(merge);
  defs.append(glow);
  tails.forEach((t, i) => {
    const h = TAIL_HUES[i % 12]!;
    const g = node("linearGradient", { id: `${id}-g${i}`, x1: 0, y1: 1, x2: 0, y2: 0 });
    const sat = t.level ? 55 + t.level * 8 : 8;
    g.append(node("stop", { offset: "0", "stop-color": `hsl(${h} ${sat}% ${t.level ? 46 : 60}%)` }),
      node("stop", { offset: "0.72", "stop-color": `hsl(${h} ${sat}% ${t.level ? 62 : 70}%)` }),
      node("stop", { offset: "1", "stop-color": t.level ? "#fff8ec" : `hsl(${h} 8% 78%)` }));
    defs.append(g);
  });
  svg.append(defs);
  const fan = node("g", { transform: "translate(130 142)" });
  tails.forEach((t, i) => {
    const a = tailAngle(i, tails.length);
    const len = 0.86 + (1 - Math.abs(a) / 90) * 0.24;
    const grp = node("g", { class: `tail lv${t.level}` + (o.selected === t.id ? " sel" : ""), transform: `rotate(${a}) scale(${len.toFixed(3)})`, tabindex: o.onPick ? 0 : -1 });
    grp.style.setProperty("--i", String(i));
    const title = node("title");
    title.textContent = `${t.emoji} ${t.title}: ${t.pattern}, сделано ${t.done}` + (t.next ? ` (до следующего узора ${t.next - t.done})` : "");
    const body = node("path", { d: TAIL, fill: `url(#${id}-g${i})`, class: "tail-body" });
    if (t.level >= 3) body.setAttribute("filter", `url(#${id}-glow)`);
    grp.append(title, body);
    if (t.level >= 2) for (const y of [-34, -52, -70]) grp.append(node("path", { d: `M-11 ${y} Q0 ${y - 7} 11 ${y}`, class: "tail-stripe" }));
    if (t.level >= 4) grp.append(node("path", { d: "M0 -104 C-6 -112 -3 -121 1 -126 C3 -119 9 -114 4 -104Z", class: "tail-flame" }));
    if (t.level >= 5) for (const [x, y] of [[-6, -44], [5, -60], [-3, -80]] as const) grp.append(node("circle", { cx: x, cy: y, r: 1.6, class: "tail-star" }));
    if (o.onPick) {
      grp.addEventListener("click", () => o.onPick!(t));
      grp.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onPick!(t); } });
    }
    fan.append(grp);
  });
  svg.append(fan);
  const face = node("text", { x: 130, y: 152, "text-anchor": "middle", class: "tails-face" });
  face.textContent = "🦊";
  svg.append(face);
  return svg;
}
