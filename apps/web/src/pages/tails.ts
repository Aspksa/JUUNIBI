/**
 * «Двенадцать хвостов достижений»: JUUNIBI as a kitsune, a white-and-gold mythical fox whose twelve fluffy tails
 * are the twelve directions of to-dos. She sits on a magic circle under the moon, in front of a far-off palace city,
 * between two lanterns, with sakura petals in the air. A tail that has not woken up is silver ash;
 * with progress it turns to white-gold fur, then gets a gold knot with a tassel («Узор»), a glow («Сияние»),
 * foxfire at the tip («Пламя») and stars («Звёздный узор»). Each awake tail lights a rune of the circle and adds foxfire
 * around her; with all twelve awake her power strikes the city on the horizon.
 */
import type { AchTail } from "../api";

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

/** Where the tails grow from, in the picture's coordinates. */
const PIVOT = [160, 200] as const;
/** A fluffy plume pointing up from (0,0) with its tip curling over, fur strands along it, and its golden tip. */
const TAIL = "M0 0 C-20 -12 -44 -42 -46 -82 C-48 -118 -28 -150 2 -160 C-8 -146 -6 -132 6 -120 C26 -98 32 -64 24 -36 C18 -16 9 -5 0 0Z";
const STRANDS = ["M-4 -8 C-26 -36 -34 -78 -18 -128", "M3 -12 C-12 -48 -16 -96 -6 -144", "M10 -22 C16 -58 10 -96 -2 -132", "M-12 -20 C-34 -54 -38 -96 -26 -120"];
const TIP = "M-40 -112 C-36 -136 -20 -154 2 -160 C-8 -146 -6 -132 6 -120 C-8 -112 -26 -110 -40 -112Z";
/** Where the foxfire floats around her. */
const WISPS: [number, number][] = [[58, 104], [262, 104], [88, 58], [232, 58], [34, 160], [286, 160]];
/** Sakura petals in the air: x, y, turn. */
const PETALS: [number, number, number][] = [[40, 40, 20], [120, 22, -30], [204, 30, 60], [286, 70, -10], [20, 120, 80], [300, 140, 30], [70, 186, -50], [250, 194, 10]];
/** Pagodas of the far-off city: x, tiers. */
const PAGODAS: [number, number][] = [[22, 3], [56, 4], [90, 2], [230, 2], [264, 4], [298, 3]];
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ";

/** A pagoda standing on y=226: a roof for every tier and a spire. */
function pagoda(x: number, tiers: number): string {
  let d = "", y = 226;
  for (let t = 0; t < tiers; t++) {
    const w = 14 - t * 2.4, h = 9;
    d += `M${x - w * 0.55} ${y} h${w * 1.1} v${-h + 3} h${-w * 1.1}Z`;
    d += `M${x - w - 3} ${y - h + 3} Q${x} ${y - h - 4} ${x + w + 3} ${y - h + 3} Q${x} ${y - h + 0.5} ${x - w - 3} ${y - h + 3}Z`;
    y -= h;
  }
  return d + `M${x - 0.8} ${y + 1} v-9 h1.6 v9Z`;
}

let uid = 0;
export function tailsEmblem(tails: AchTail[], o: { size?: "sm" | "lg"; onPick?: (t: AchTail) => void; selected?: string | undefined } = {}): SVGSVGElement {
  const awake = tails.filter((t) => t.level).length;
  const power = Math.min(1, awake / 12);
  const svg = node("svg", { viewBox: "0 0 320 262", class: "tails-svg kitsune " + (o.size ?? "sm") + (awake === 12 ? " full" : awake ? "" : " asleep"), role: "img",
    "aria-label": `Кицунэ JUUNIBI: проснулось хвостов ${awake} из 12` });
  svg.style.setProperty("--power", power.toFixed(2));
  const id = `k${++uid}`;
  const defs = node("defs");
  const filter = (fid: string, ...parts: SVGElement[]) => { const f = node("filter", { id: `${id}-${fid}`, x: "-60%", y: "-60%", width: "220%", height: "220%" }); f.append(...parts); defs.append(f); };
  const merge = (...ins: string[]) => { const m = node("feMerge"); m.append(...ins.map((i) => node("feMergeNode", { in: i }))); return m; };
  filter("glow", node("feGaussianBlur", { stdDeviation: 3.2, result: "b" }), merge("b", "SourceGraphic"));
  filter("soft", node("feGaussianBlur", { stdDeviation: 6 }));
  // ragged, furry edges for the tails
  filter("fuzz", node("feTurbulence", { type: "fractalNoise", baseFrequency: 0.06, numOctaves: 2, seed: 7, result: "n" }),
    node("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: 3.5, xChannelSelector: "R", yChannelSelector: "G" }));
  const grad = (gid: string, stops: [number, string, number?][], attrs: Record<string, string | number> = { x1: 0, y1: 1, x2: 0, y2: 0 }, radial = false) => {
    const g = radial ? node("radialGradient", { id: `${id}-${gid}`, ...attrs }) : node("linearGradient", { id: `${id}-${gid}`, ...attrs });
    for (const [off, c, op] of stops) g.append(node("stop", { offset: off, "stop-color": c, ...(op === undefined ? {} : { "stop-opacity": op }) }));
    defs.append(g);
  };
  grad("aura", [[0, "#ffd98a", 0.5], [0.45, "#f0a63a", 0.18], [1, "#7c3a6f", 0]], { cx: "50%", cy: "58%", r: "50%" }, true);
  grad("moon", [[0, "#fffaf0"], [0.7, "#fbe9c4"], [1, "#f1d39a"]], { cx: "40%", cy: "40%", r: "60%" }, true);
  grad("moonglow", [[0, "#ffe9b8", 0.55], [1, "#ffe9b8", 0]], { cx: "50%", cy: "50%", r: "50%" }, true);
  grad("sky", [[0, "#ffb24a", 0.5], [0.6, "#c2283a", 0.15], [1, "#c2283a", 0]], { cx: "50%", cy: "100%", r: "70%" }, true);
  grad("fur", [[0, "#e7d6bd"], [0.6, "#fbf3e6"], [1, "#fffdf8"]]);
  grad("shade", [[0, "#7a4a1a", 0], [0.55, "#7a4a1a", 0], [1, "#7a4a1a", 0.42]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  grad("halo", [[0, "#140818", 0.6], [0.7, "#140818", 0.25], [1, "#140818", 0]], { cx: "50%", cy: "50%", r: "50%" }, true);
  grad("furside", [[0, "#d9c3a2"], [1, "#f6ebda"]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  grad("gold", [[0, "#9c6a1c"], [0.5, "#f2c25a"], [1, "#fff0b8"]], { x1: 0, y1: 1, x2: 1, y2: 0 });
  grad("eye", [[0, "#fff5c4"], [0.55, "#ffcb47"], [1, "#e0861c"]], { cx: "50%", cy: "50%", r: "60%" }, true);
  grad("wisp", [[0, "#ffffff"], [0.45, "#ffe8a6"], [1, "#ff9d2e", 0]], { cx: "50%", cy: "65%", r: "60%" }, true);
  grad("lantern", [[0, "#ffe7a3"], [0.5, "#ff9f3d"], [1, "#c2412d"]], { cx: "50%", cy: "45%", r: "60%" }, true);
  tails.forEach((t, i) => {
    const h = TAIL_HUES[i % 12]!;
    grad(`t${i}`, t.level
      ? [[0, `hsl(${h + 20} 55% 78%)`], [0.18, "#fbf1e2"], [0.62, "#fffdf8"], [0.86, "#f8dc94"], [1, "#e9ad3e"]]
      : [[0, "#6f6a77"], [0.7, "#a9a4b1"], [1, "#c9c5cf"]]);
  });
  svg.append(defs);

  // night: the glow of her power, the moon, the city it could reach, two lanterns
  svg.append(node("ellipse", { cx: 160, cy: 140, rx: 156, ry: 122, fill: `url(#${id}-aura)`, class: "k-aura" }),
    node("circle", { cx: 262, cy: 46, r: 40, fill: `url(#${id}-moonglow)`, class: "k-moonglow" }),
    node("circle", { cx: 262, cy: 46, r: 21, fill: `url(#${id}-moon)`, class: "k-moon" }));
  const city = node("g", { class: "k-city" });
  city.append(node("ellipse", { cx: 160, cy: 226, rx: 170, ry: 48, fill: `url(#${id}-sky)`, class: "k-city-sky" }));
  for (const [x, tiers] of PAGODAS) city.append(node("path", { d: pagoda(x, tiers), class: "k-house" }));
  for (const [x, tiers] of PAGODAS) for (let t = 0; t < tiers; t++) city.append(node("rect", { x: x - 1.5, y: 226 - t * 9 - 5, width: 3, height: 3, class: "k-window" }));
  if (awake === 12) for (const [x1, x2] of [[52, 60], [268, 260]] as const) city.append(node("path", { d: `M${x1} 120 L${x2} 152 L${x1 + 4} 158 L${x2 - 2} 196`, class: "k-bolt" }));
  svg.append(city);
  for (const x of [22, 298]) {
    const l = node("g", { class: "k-lantern", transform: `translate(${x} 0)` });
    l.append(node("path", { d: "M0 0 V30", class: "k-lantern-cord" }), node("rect", { x: -7, y: 30, width: 14, height: 3, rx: 1, class: "k-lantern-cap" }),
      node("ellipse", { cx: 0, cy: 44, rx: 10, ry: 12, fill: `url(#${id}-lantern)`, class: "k-lantern-body", filter: `url(#${id}-glow)` }),
      node("path", { d: "M-9 40 H9 M-10 46 H10", class: "k-lantern-rib" }), node("rect", { x: -7, y: 55, width: 14, height: 3, rx: 1, class: "k-lantern-cap" }),
      node("path", { d: "M0 58 V68 M-2 68 h4 v6 h-4Z", class: "k-lantern-tassel" }));
    svg.append(l);
  }

  // the magic circle she sits on: one rune per tail
  const circle = node("g", { class: "k-circle" });
  circle.append(node("ellipse", { cx: 160, cy: 230, rx: 124, ry: 20, class: "k-ring" }), node("ellipse", { cx: 160, cy: 230, rx: 98, ry: 14, class: "k-ring k-ring-in" }));
  tails.forEach((t, i) => {
    const a = Math.PI * (0.08 + (0.84 * i) / 11);
    const r = node("text", { x: (160 - Math.cos(a) * 111).toFixed(1), y: (231 + Math.sin(a) * 17 + 3).toFixed(1), "text-anchor": "middle", class: "k-rune" + (t.level ? " on" : "") });
    r.textContent = RUNES[i] ?? "ᛟ";
    circle.append(r);
  });
  svg.append(circle);

  // twelve fluffy tails behind her
  const fan = node("g", { class: "k-tails" });
  tails.forEach((t, i) => {
    const a = tailAngle(i, tails.length);
    const len = 0.98 + (1 - Math.abs(a) / 90) * 0.34;
    const grp = node("g", { class: `tail lv${t.level}` + (o.selected === t.id ? " sel" : ""), transform: `translate(${PIVOT[0]} ${PIVOT[1]}) rotate(${a.toFixed(2)}) scale(${(len * 0.92).toFixed(3)} ${len.toFixed(3)})`, tabindex: o.onPick ? 0 : -1 });
    grp.style.setProperty("--i", String(i));
    const title = node("title");
    title.textContent = `${t.emoji} ${t.title}: ${t.pattern}, сделано ${t.done}` + (t.next ? ` (до следующего узора ${t.next - t.done})` : "");
    const sway = node("g", { class: "tail-sway" });
    const fur = node("g", { filter: `url(#${id}-fuzz)` });
    const body = node("path", { d: TAIL, fill: `url(#${id}-t${i})`, class: "tail-body" });
    if (t.level >= 3) body.setAttribute("filter", `url(#${id}-glow)`);
    fur.append(body);
    // the shaded side gives the plume its volume
    if (t.level) fur.append(node("path", { d: TAIL, fill: `url(#${id}-shade)`, class: "tail-shade" }));
    fur.append(...STRANDS.map((d) => node("path", { d, class: "tail-strand" })));
    if (t.level) fur.append(node("path", { d: TIP, class: "tail-tip" }));
    sway.append(fur);
    if (t.level >= 2) {
      // a gold knot with a tassel, like a hairpin on the fur
      const knot = node("g", { class: "tail-knot", transform: "translate(-14 -74)" });
      knot.append(node("path", { d: "M0 -6 L2 -2 L6 0 L2 2 L0 6 L-2 2 L-6 0 L-2 -2Z", fill: `url(#${id}-gold)` }), node("circle", { r: 1.6, class: "tail-knot-gem" }),
        node("path", { d: "M0 6 V16", class: "tail-cord" }), node("path", { d: "M-2.2 16 h4.4 l1 9 h-6.4Z", fill: `url(#${id}-gold)`, class: "tail-tassel" }));
      sway.append(knot);
    }
    if (t.level >= 4) sway.append(node("path", { d: "M2 -158 C-6 -168 -2 -180 4 -188 C6 -180 13 -174 9 -160Z", class: "tail-flame", filter: `url(#${id}-glow)` }));
    if (t.level >= 5) for (const [x, y] of [[-20, -50], [6, -70], [-24, -96], [-6, -124]] as const) sway.append(node("circle", { cx: x, cy: y, r: 1.8, class: "tail-star" }));
    grp.append(title, sway);
    if (o.onPick) {
      grp.addEventListener("click", () => o.onPick!(t));
      grp.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onPick!(t); } });
    }
    fan.append(grp);
  });
  svg.append(fan);
  // a soft shadow behind her, so the white fox stands out from the white tails
  svg.append(node("ellipse", { cx: 160, cy: 156, rx: 70, ry: 92, fill: `url(#${id}-halo)`, class: "k-halo" }));

  // the fox herself: white fur, gold ears and markings
  const fox = node("g", { class: "k-fox" });
  const p = (d: string, cls: string, fill?: string) => node("path", { d, class: cls, ...(fill ? { fill } : {}) });
  fox.append(
    node("ellipse", { cx: 160, cy: 228, rx: 48, ry: 7, class: "k-shadow" }),
    p("M160 116 C134 120 120 146 118 174 C116 198 126 218 142 226 L178 226 C194 218 204 198 202 174 C200 146 186 120 160 116Z", "k-fur", `url(#${id}-furside)`),
    p("M160 122 C144 129 136 152 139 176 C142 194 151 205 160 212 C169 205 178 194 181 176 C184 152 176 129 160 122Z", "k-belly", `url(#${id}-fur)`),
    p("M148 136 q-4 6 0 10 M172 136 q4 6 0 10 M150 160 q-4 6 0 10 M170 160 q4 6 0 10 M156 184 q-3 5 0 9 M164 184 q3 5 0 9", "k-fluff"),
    p("M141 182 C139 198 139 214 141 226 L153 226 C153 212 153 198 151 182Z M179 182 C181 198 181 214 179 226 L167 226 C167 212 167 198 169 182Z", "k-leg", `url(#${id}-fur)`),
    p("M139 220 q7 -4 14 0 v6 h-14Z M167 220 q7 -4 14 0 v6 h-14Z", "k-paw", `url(#${id}-gold)`),
    // gold rope with red tassels and a jewel: a shrine fox
    p("M136 128 Q160 142 184 128", "k-rope"),
    p("M146 135 v10 M174 135 v10", "k-tassel-cord"),
    p("M144 144 h4 l1 8 h-6Z M172 144 h4 l1 8 h-6Z", "k-tassel"),
    node("circle", { cx: 160, cy: 138, r: 5.5, class: "k-jewel", filter: `url(#${id}-glow)` }),
    // head
    p("M131 82 L124 36 L156 68Z M189 82 L196 36 L164 68Z", "k-ear", `url(#${id}-furside)`),
    p("M134 77 L129 46 L151 69Z M186 77 L191 46 L169 69Z", "k-ear-in", `url(#${id}-gold)`),
    p("M124 36 L128 52 L135 47Z M196 36 L192 52 L185 47Z", "k-ear-tip"),
    p("M122 92 C124 76 140 66 160 66 C180 66 196 76 198 92 C200 102 192 111 183 117 C176 123 167 129 160 131 C153 129 144 123 137 117 C128 111 120 102 122 92Z", "k-head", `url(#${id}-fur)`),
    p("M123 94 L102 110 L113 109 L106 118 L131 110Z M197 94 L218 110 L207 109 L214 118 L189 110Z", "k-cheek", `url(#${id}-fur)`),
    // gold markings: a flame on the forehead and strokes under the eyes
    p("M160 70 C154 78 154 86 160 92 C166 86 166 78 160 70Z", "k-mark", `url(#${id}-gold)`),
    node("circle", { cx: 160, cy: 83, r: 1.8, class: "k-mark-dot" }),
    p("M134 104 q-5 4 -10 4 M186 104 q5 4 10 4", "k-whisker-mark"),
    ...(awake ? [
      p("M131 87 Q143 85 155 95 Q142 100 131 87Z M189 87 Q177 85 165 95 Q178 100 189 87Z", "k-eye", `url(#${id}-eye)`),
      p("M128 85 Q143 82 156 95 M192 85 Q177 82 164 95", "k-liner"),
      node("ellipse", { cx: 145, cy: 93, rx: 1.4, ry: 3.6, class: "k-pupil" }),
      node("ellipse", { cx: 175, cy: 93, rx: 1.4, ry: 3.6, class: "k-pupil" })]
      // asleep: closed eyes
      : [p("M132 91 Q143 98 155 94 M188 91 Q177 98 165 94", "k-liner")]),
    p("M128 82 q8 -4 15 -1 M192 82 q-8 -4 -15 -1", "k-brow"),
    node("ellipse", { cx: 160, cy: 119, rx: 4.6, ry: 3.2, class: "k-nose" }),
    p("M160 122 L160 125 M160 125 Q156 128 153 126 M160 125 Q164 128 167 126", "k-mouth"),
    // a gold hairpin with a flower between the ears
    p("M146 66 L150 58 M174 66 L170 58", "k-pin"),
    node("circle", { cx: 150, cy: 57, r: 3.4, fill: `url(#${id}-gold)`, class: "k-pin-flower" }),
    node("circle", { cx: 170, cy: 57, r: 3.4, fill: `url(#${id}-gold)`, class: "k-pin-flower" }),
  );
  svg.append(fox);

  // sakura petals and foxfire: one wisp for every two awake tails (asleep, a single faint one keeps watch)
  const petals = node("g", { class: "k-petals" });
  PETALS.forEach(([x, y, r], i) => {
    const g = node("g", { transform: `translate(${x} ${y}) rotate(${r})` });
    const pt = node("path", { d: "M0 -4 C3 -3 4 1 0 4 C-4 1 -3 -3 0 -4Z", class: "k-petal" });
    pt.style.setProperty("--i", String(i));
    g.append(pt);
    petals.append(g);
  });
  svg.append(petals);
  const wisps = node("g", { class: "k-wisps" });
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
