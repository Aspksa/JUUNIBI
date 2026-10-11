/**
 * «Двенадцать хвостов достижений»: JUUNIBI as a white-and-gold kitsune with twelve tails, the twelve directions of to-dos.
 * The picture is the owner's own illustration (assets/kitsune.webp): she sits on a magic circle under the moon,
 * between two lanterns, with sakura petals and foxfire in the air. Until the first tail wakes up she sleeps
 * (the picture is dim and grey); with all twelve awake she shines brighter. Where the tails can be picked,
 * each tail of the picture is a button.
 */
import type { AchTail } from "../api";
import kitsuneUrl from "../assets/kitsune.webp";

const SVG = "http://www.w3.org/2000/svg";
const node = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
/** Twelve naturally varying red/ginger coats: the warm tint at the root of each tail. */
export const TAIL_HUES = [13, 17, 20, 12, 8, 19, 15, 10, 22, 6, 16, 11];
/** The angle of tail `i` of `n` in degrees: a fan from −78° to +78° (0 is straight up). */
export const tailAngle = (i: number, n = 12) => -78 + (156 * i) / Math.max(1, n - 1);

/** The picture's size in pixels. */
const W = 1145, H = 934;
/** The middle of each tail in the picture, from the lowest on the left to the lowest on the right. */
const TAIL_SPOTS: [number, number][] = [[110, 600], [130, 420], [210, 300], [300, 190], [390, 120], [470, 60],
  [700, 90], [830, 190], [960, 320], [1030, 430], [1060, 560], [1000, 660]];

export function tailsEmblem(tails: AchTail[], o: { size?: "sm" | "lg"; onPick?: (t: AchTail) => void; selected?: string | undefined } = {}): HTMLElement {
  const awake = tails.filter((t) => t.level).length;
  const box = document.createElement("div");
  box.className = "kitsune-art " + (o.size ?? "sm") + (awake === 12 ? " full" : awake ? "" : " asleep");
  box.style.setProperty("--power", Math.min(1, awake / 12).toFixed(2));
  const img = document.createElement("img");
  img.src = kitsuneUrl;
  img.width = W;
  img.height = H;
  img.alt = `Кицунэ JUUNIBI: проснулось хвостов ${awake} из 12`;
  img.decoding = "async";
  img.draggable = false;
  box.append(img, Object.assign(document.createElement("span"), { className: "kitsune-glow" }));
  if (!o.onPick) return box;

  // each tail of the picture is a button: a ring lights up on it on hover and when it is chosen
  const svg = node("svg", { viewBox: `0 0 ${W} ${H}`, class: "kitsune-spots", role: "group", "aria-label": "Двенадцать хвостов" });
  tails.slice(0, 12).forEach((t, i) => {
    const [x, y] = TAIL_SPOTS[i]!;
    const g = node("g", { class: `kitsune-spot lv${t.level}` + (o.selected === t.id ? " sel" : ""), tabindex: 0, role: "button",
      "aria-label": `${t.title}: ${t.pattern}` + (o.selected === t.id ? ", выбран" : "") });
    const title = node("title");
    title.textContent = `${t.emoji} ${t.title}: ${t.pattern}, сделано ${t.done}` + (t.next ? ` (до следующего узора ${t.next - t.done})` : "");
    g.append(title, node("circle", { cx: x, cy: y, r: 74, class: "kitsune-hit" }), node("circle", { cx: x, cy: y, r: 58, class: "kitsune-ring" }));
    g.addEventListener("click", () => o.onPick!(t));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onPick!(t); } });
    svg.append(g);
  });
  box.append(svg);
  return box;
}
