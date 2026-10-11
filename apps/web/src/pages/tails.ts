/**
 * «Двенадцать хвостов достижений»: JUUNIBI as a kitsune, a mythical fox whose twelve tails are the twelve directions of to-dos.
 * She sits on a magic circle in front of a far-off city. A tail that has not woken up is grey ash;
 * with progress it turns to fire-red fur, then gets a pattern («Узор»), a glow («Сияние»), foxfire at the tip («Пламя»)
 * and stars («Звёздный узор»). Each awake tail lights a rune of the circle and adds foxfire around her;
 * with all twelve awake her power reaches the city on the horizon.
 */
import type { AchTail } from "../api";

const SVG = "http://www.w3.org/2000/svg";
const node = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
/** Twelve naturally varying red/ginger fox coats, rather than a rainbow. */
export const TAIL_HUES = [13, 17, 20, 12, 8, 19, 15, 10, 22, 6, 16, 11];
/** The angle of tail `i` of `n` in degrees: a fan from −78° to +78° (0 is straight up). */
export const tailAngle = (i: number, n = 12) => -78 + (156 * i) / Math.max(1, n - 1);

/** Where the tails grow from, in the picture's coordinates. */
const PIVOT = [160, 186] as const;
/** A long plume pointing up from (0,0), and its pale tip. */
const TAIL = "M0 0 C-14 -16 -31 -44 -29 -76 C-27 -100 -13 -120 4 -128 C0 -116 3 -106 9 -98 C24 -74 22 -36 7 -10Z";
const TIP = "M-26 -101 C-21 -113 -10 -123 4 -128 C0 -116 3 -106 9 -98 C-1 -96 -14 -97 -26 -101Z";
const SWIRLS = ["M-13 -28 q8 -6 16 0", "M-19 -48 q10 -8 21 0", "M-21 -68 q10 -8 22 -1", "M-19 -86 q9 -7 19 -1"];
/** Where the foxfire floats around her. */
const WISPS: [number, number][] = [[64, 96], [256, 96], [92, 50], [228, 50], [40, 150], [280, 150]];
/** A far-off city: x, width, height of each house. */
const CITY: [number, number, number][] = [[8, 14, 16], [22, 9, 26], [31, 15, 13], [46, 7, 34], [53, 16, 19], [69, 10, 28], [79, 14, 14], [93, 8, 22], [219, 9, 20], [228, 14, 16], [242, 8, 30], [250, 16, 18], [266, 7, 36], [273, 15, 22], [288, 10, 27], [298, 16, 15]];
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ";

let uid = 0;
export function tailsEmblem(tails: AchTail[], o: { size?: "sm" | "lg"; onPick?: (t: AchTail) => void; selected?: string | undefined } = {}): SVGSVGElement {
  const awake = tails.filter((t) => t.level).length;
  const power = Math.min(1, awake / 12);
  const svg = node("svg", { viewBox: "0 0 320 250", class: "tails-svg kitsune " + (o.size ?? "sm") + (awake === 12 ? " full" : awake ? "" : " asleep"), role: "img",
    "aria-label": `Кицунэ JUUNIBI: проснулось хвостов ${awake} из 12` });
  svg.style.setProperty("--power", power.toFixed(2));
  const id = `k${++uid}`;
  const defs = node("defs");
  const glow = node("filter", { id: id + "-glow", x: "-60%", y: "-60%", width: "220%", height: "220%" });
  glow.append(node("feGaussianBlur", { stdDeviation: 3.4, result: "b" }));
  const merge = node("feMerge");
  merge.append(node("feMergeNode", { in: "b" }), node("feMergeNode", { in: "SourceGraphic" }));
  glow.append(merge);
  const soft = node("filter", { id: id + "-soft", x: "-50%", y: "-50%", width: "200%", height: "200%" });
  soft.append(node("feGaussianBlur", { stdDeviation: 6 }));
  const grad = (gid: string, stops: [number, string, number?][], o2: Record<string, string | number> = { x1: 0, y1: 1, x2: 0, y2: 0 }, radial = false) => {
    const g = radial ? node("radialGradient", { id: gid, ...o2 }) : node("linearGradient", { id: gid, ...o2 });
    for (const [off, c, op] of stops) g.append(node("stop", { offset: off, "stop-color": c, ...(op === undefined ? {} : { "stop-opacity": op }) }));
    defs.append(g);
  };
  grad(id + "-aura", [[0, "#ff7a2f", 0.55], [0.45, "#e2381f", 0.22], [1, "#7c1d6f", 0]], { cx: "50%", cy: "55%", r: "50%" }, true);
  grad(id + "-fur", [[0, "#9c2a12"], [0.55, "#e0541f"], [1, "#f6923a"]], { x1: 0, y1: 1, x2: 0, y2: 0 });
  grad(id + "-belly", [[0, "#f2dcc4"], [1, "#fff8ef"]]);
  grad(id + "-eye", [[0, "#fff3b0"], [0.6, "#ffc23d"], [1, "#ff7b1c"]], { cx: "50%", cy: "50%", r: "60%" }, true);
  grad(id + "-wisp", [[0, "#ffffff"], [0.45, "#9fe8ff"], [1, "#3b82f6", 0]], { cx: "50%", cy: "65%", r: "60%" }, true);
  grad(id + "-sky", [[0, "#ff5a2a", 0.55], [0.6, "#c2283a", 0.18], [1, "#c2283a", 0]], { cx: "50%", cy: "100%", r: "70%" }, true);
  grad(id + "-moon", [[0, "#fff4dc", 0.9], [0.7, "#ffd9a0", 0.35], [1, "#ffb36b", 0]], { cx: "50%", cy: "50%", r: "50%" }, true);
  tails.forEach((t, i) => {
    const h = TAIL_HUES[i % 12]!;
    grad(`${id}-t${i}`, t.level
      ? [[0, `hsl(${h} 82% 26%)`], [0.5, `hsl(${h} ${Math.min(94, 76 + t.level * 3)}% 47%)`], [1, `hsl(${h + 14} 92% 62%)`]]
      : [[0, "#55505a"], [1, "#9b95a0"]]);
  });
  defs.append(glow, soft);
  svg.append(defs);

  // the glow of her power and the city it could reach
  svg.append(node("ellipse", { cx: 160, cy: 132, rx: 150, ry: 118, fill: `url(#${id}-aura)`, class: "k-aura" }),
    node("circle", { cx: 160, cy: 74, r: 54, fill: `url(#${id}-moon)`, class: "k-moon" }));
  const city = node("g", { class: "k-city" });
  city.append(node("ellipse", { cx: 160, cy: 214, rx: 170, ry: 46, fill: `url(#${id}-sky)`, class: "k-city-sky" }));
  for (const [x, w, hgt] of CITY) {
    city.append(node("rect", { x, y: 216 - hgt, width: w, height: hgt, rx: 1, class: "k-house" }));
    for (let wy = 216 - hgt + 5; wy < 212; wy += 8) city.append(node("rect", { x: x + w / 2 - 1.5, y: wy, width: 3, height: 3, class: "k-window" }));
  }
  if (awake === 12) for (const [x1, x2] of [[52, 62], [262, 254]] as const) city.append(node("path", { d: `M${x1} 120 L${x2} 150 L${x1 + 4} 156 L${x2 - 2} 186`, class: "k-bolt" }));
  svg.append(city);

  // the magic circle she sits on: one rune per tail
  const circle = node("g", { class: "k-circle" });
  circle.append(node("ellipse", { cx: 160, cy: 218, rx: 122, ry: 20, class: "k-ring" }), node("ellipse", { cx: 160, cy: 218, rx: 96, ry: 14, class: "k-ring k-ring-in" }));
  tails.forEach((t, i) => {
    const a = Math.PI * (0.08 + (0.84 * i) / 11);
    const r = node("text", { x: (160 - Math.cos(a) * 109).toFixed(1), y: (219 + Math.sin(a) * 17 + 3).toFixed(1), "text-anchor": "middle", class: "k-rune" + (t.level ? " on" : "") });
    r.textContent = RUNES[i] ?? "ᛟ";
    circle.append(r);
  });
  svg.append(circle);

  // twelve tails behind her
  const fan = node("g", { class: "k-tails" });
  tails.forEach((t, i) => {
    const a = tailAngle(i, tails.length);
    const len = 0.92 + (1 - Math.abs(a) / 90) * 0.36;
    const grp = node("g", { class: `tail lv${t.level}` + (o.selected === t.id ? " sel" : ""), transform: `translate(${PIVOT[0]} ${PIVOT[1]}) rotate(${a.toFixed(2)}) scale(${(len * 0.74).toFixed(3)} ${len.toFixed(3)})`, tabindex: o.onPick ? 0 : -1 });
    grp.style.setProperty("--i", String(i));
    const title = node("title");
    title.textContent = `${t.emoji} ${t.title}: ${t.pattern}, сделано ${t.done}` + (t.next ? ` (до следующего узора ${t.next - t.done})` : "");
    const sway = node("g", { class: "tail-sway" });
    const body = node("path", { d: TAIL, fill: `url(#${id}-t${i})`, class: "tail-body" });
    if (t.level >= 3) body.setAttribute("filter", `url(#${id}-glow)`);
    sway.append(body, node("path", { d: TIP, class: "tail-tip" }));
    if (t.level >= 2) for (const d of SWIRLS) sway.append(node("path", { d, class: "tail-stripe" }));
    if (t.level >= 4) sway.append(node("path", { d: "M5 -124 C-3 -133 1 -145 7 -152 C8 -144 15 -138 11 -126Z", class: "tail-flame", filter: `url(#${id}-glow)` }));
    if (t.level >= 5) for (const [x, y] of [[-12, -40], [4, -60], [-10, -78], [0, -100]] as const) sway.append(node("circle", { cx: x, cy: y, r: 1.7, class: "tail-star" }));
    grp.append(title, sway);
    if (o.onPick) {
      grp.addEventListener("click", () => o.onPick!(t));
      grp.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onPick!(t); } });
    }
    fan.append(grp);
  });
  svg.append(fan);

  // the fox herself
  const fox = node("g", { class: "k-fox" });
  const p = (d: string, cls: string, fill?: string) => node("path", { d, class: cls, ...(fill ? { fill } : {}) });
  fox.append(
    node("ellipse", { cx: 160, cy: 216, rx: 46, ry: 7, class: "k-shadow" }),
    p("M160 106 C134 110 120 136 118 164 C116 188 126 208 142 214 L178 214 C194 208 204 188 202 164 C200 136 186 110 160 106Z", "k-fur", `url(#${id}-fur)`),
    p("M160 114 C145 121 138 142 141 165 C144 183 152 193 160 199 C168 193 176 183 179 165 C182 142 175 121 160 114Z", "k-belly", `url(#${id}-belly)`),
    p("M150 128 l-5 6 6 -1 M170 128 l5 6 -6 -1 M152 146 l-5 6 6 -1 M168 146 l5 6 -6 -1", "k-fluff"),
    p("M141 172 C139 188 139 202 141 214 L153 214 C153 200 153 186 151 172Z M179 172 C181 188 181 202 179 214 L167 214 C167 200 167 186 169 172Z", "k-leg", `url(#${id}-fur)`),
    p("M140 200 C140 206 140 210 141 214 L153 214 C153 209 153 205 153 200Z M180 200 C180 206 180 210 179 214 L167 214 C167 209 167 205 167 200Z", "k-sock"),
    // rope with a jewel: a shrine fox
    p("M138 118 Q160 130 182 118", "k-rope"),
    node("circle", { cx: 160, cy: 127, r: 5, class: "k-jewel", filter: `url(#${id}-glow)` }),
    // head
    p("M131 72 L126 30 L155 58Z M189 72 L194 30 L165 58Z", "k-ear", `url(#${id}-fur)`),
    p("M134 67 L131 40 L150 59Z M186 67 L189 40 L170 59Z", "k-ear-in"),
    p("M126 30 L129 46 L135 42Z M194 30 L191 46 L185 42Z", "k-ear-tip"),
    p("M122 82 C124 66 140 56 160 56 C180 56 196 66 198 82 C200 92 192 101 183 107 C176 113 167 119 160 121 C153 119 144 113 137 107 C128 101 120 92 122 82Z", "k-head", `url(#${id}-fur)`),
    p("M123 84 L104 100 L114 99 L108 108 L130 100Z M197 84 L216 100 L206 99 L212 108 L190 100Z", "k-cheek"),
    p("M123 88 C131 99 143 101 151 97 C155 106 157 114 160 122 C163 114 165 106 169 97 C177 101 189 99 197 88 C196 98 188 106 179 111 C172 116 166 120 160 122 C154 120 148 116 141 111 C132 106 124 98 123 88Z", "k-mask"),
    p("M160 62 C155 69 155 76 160 81 C165 76 165 69 160 62Z", "k-mark"),
    p("M137 94 l-6 4 M183 94 l6 4", "k-whisker-mark"),
    ...(awake ? [
      p("M131 77 Q143 75 155 85 Q142 90 131 77Z M189 77 Q177 75 165 85 Q178 90 189 77Z", "k-eye", `url(#${id}-eye)`),
      p("M129 75 Q143 72 156 85 M191 75 Q177 72 164 85", "k-liner"),
      node("ellipse", { cx: 145, cy: 83, rx: 1.4, ry: 3.6, class: "k-pupil" }),
      node("ellipse", { cx: 175, cy: 83, rx: 1.4, ry: 3.6, class: "k-pupil" })]
      // asleep: closed eyes
      : [p("M132 81 Q143 88 155 84 M188 81 Q177 88 165 84", "k-liner")]),
    node("ellipse", { cx: 160, cy: 109, rx: 4.6, ry: 3.2, class: "k-nose" }),
    p("M160 112 L160 115 M160 115 Q156 118 153 116 M160 115 Q164 118 167 116", "k-mouth"),
  );
  svg.append(fox);

  // foxfire: one wisp for every two awake tails
  const wisps = node("g", { class: "k-wisps" });
  // asleep, a single faint wisp keeps watch
  WISPS.slice(0, Math.max(1, Math.ceil(awake / 2))).forEach(([x, y], i) => {
    const w = node("g", { class: "k-wisp" + (awake ? "" : " dim"), transform: `translate(${x} ${y})` });
    w.style.setProperty("--i", String(i));
    const inner = node("g", { class: "k-wisp-float" });
    inner.append(node("circle", { cx: 0, cy: 2, r: 11, fill: `url(#${id}-wisp)`, filter: `url(#${id}-soft)`, class: "k-wisp-halo" }),
      node("path", { d: "M0 -11 C-4 -5 -7 -1 -6 4 C-5 8 -2 10 0 10 C2 10 5 8 6 4 C7 -1 4 -5 0 -11Z", fill: `url(#${id}-wisp)` }));
    w.append(inner);
    wisps.append(w);
  });
  svg.append(wisps);
  return svg;
}
