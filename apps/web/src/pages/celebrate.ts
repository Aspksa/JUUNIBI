/**
 * The celebration when an award is won: one of 24 effects (two per rarity tier) around a card with the award,
 * its medal and JUUNIBI's words. With reduced motion the card simply appears. Esc, the button or a click outside close it.
 */
import { el } from "../dom";
import "./achievements.css";

export interface Celebration {
  effect: string; emoji: string; title: string; tierTitle: string; color: string;
  medal?: string | undefined; text?: string | null; more?: number;
  open?: (() => void) | undefined;
}
const SVG = "http://www.w3.org/2000/svg";
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;

type Motion = "burst" | "rain" | "rise" | "orbit" | "pop" | "gather" | "sweep" | "spiral" | "march";
interface Part { glyph: string[]; count: number; motion: Motion; colors?: string[]; size?: [number, number]; spread?: number; dur?: [number, number]; delay?: number }
/** What each effect throws around the card, and the piece in the middle (`stage`). */
const FX: Record<string, { parts: Part[]; stage?: string; flash?: string }> = {
  paws: { parts: [{ glyph: ["🐾"], count: 12, motion: "march", size: [18, 26], dur: [0.5, 0.6] }, { glyph: ["•"], count: 18, motion: "burst", colors: ["#facc15", "#fde68a"], size: [8, 14], spread: 180, delay: 1.2 }] },
  confetti: { parts: [{ glyph: ["▮", "●", "▲", "■"], count: 70, motion: "burst", colors: ["#f43f5e", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#f97316"], size: [8, 14], spread: 340, dur: [1.6, 2.4] }] },
  sakura: { parts: [{ glyph: ["🌸", "🌸", "💮"], count: 34, motion: "rain", size: [14, 26], dur: [3, 4.6] }] },
  rainbow: { parts: [{ glyph: ["●"], count: 42, motion: "sweep", colors: ["#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"], size: [10, 16], dur: [1.4, 1.8] }] },
  starburst: { parts: [{ glyph: ["✦", "✧", "★"], count: 30, motion: "burst", colors: ["#fde68a", "#fff", "#facc15"], size: [12, 24], spread: 260 }], flash: "#fff7d6" },
  medal: { parts: [{ glyph: ["✦"], count: 20, motion: "burst", colors: ["#fbbf24", "#fde68a"], size: [10, 16], spread: 160, delay: 0.5 }], stage: "medal" },
  crystal: { parts: [{ glyph: ["🔹", "◆", "◇"], count: 26, motion: "gather", colors: ["#a5b4fc", "#c4b5fd", "#e0e7ff"], size: [10, 18], spread: 260 }], stage: "crystal" },
  lightning: { parts: [{ glyph: ["⚡"], count: 10, motion: "pop", size: [18, 30], spread: 220 }], stage: "bolt", flash: "#c7d2fe" },
  trophy: { parts: [{ glyph: ["❄", "◆"], count: 24, motion: "gather", colors: ["#e9d5ff", "#c084fc", "#fff"], size: [10, 18], spread: 240 }], stage: "trophy" },
  lanterns: { parts: [{ glyph: ["🏮"], count: 16, motion: "rise", size: [20, 34], dur: [4, 6] }, { glyph: ["•"], count: 20, motion: "rise", colors: ["#fdba74", "#fef3c7"], size: [4, 8], dur: [3, 5] }] },
  parade: { parts: [{ glyph: ["🎺", "🥁", "🚩", "🎉", "🎷", "🪅"], count: 12, motion: "march", size: [22, 30], dur: [0.4, 0.5] }, { glyph: ["▮", "●"], count: 30, motion: "rain", colors: ["#f43f5e", "#facc15", "#22c55e", "#3b82f6"], size: [6, 10], dur: [2, 3] }] },
  scroll: { parts: [{ glyph: ["✦"], count: 14, motion: "pop", colors: ["#fcd34d"], size: [10, 14], spread: 200, delay: 0.8 }], stage: "scroll" },
  foxfire: { parts: [{ glyph: ["🔥"], count: 14, motion: "orbit", size: [18, 28], dur: [2.2, 2.6] }, { glyph: ["●"], count: 30, motion: "rise", colors: ["#fb923c", "#f97316", "#60a5fa"], size: [5, 10], dur: [1.8, 3] }], flash: "#ffedd5" },
  dragon: { parts: [{ glyph: ["🔥", "✦"], count: 26, motion: "sweep", colors: ["#f97316", "#facc15"], size: [12, 22], dur: [1.6, 2] }], stage: "dragon", flash: "#fed7aa" },
  crown: { parts: [{ glyph: ["✦", "✧"], count: 22, motion: "pop", colors: ["#fde047", "#fff"], size: [10, 18], spread: 160, delay: 0.9 }], stage: "crown" },
  chest: { parts: [{ glyph: ["🪙", "💎", "✦"], count: 26, motion: "burst", colors: ["#facc15"], size: [14, 22], spread: 240, delay: 0.9 }], stage: "chest" },
  comet: { parts: [{ glyph: ["✦", "•"], count: 30, motion: "burst", colors: ["#e0e7ff", "#a5b4fc", "#fff"], size: [8, 16], spread: 260, delay: 1 }], stage: "comet", flash: "#e0e7ff" },
  planets: { parts: [{ glyph: ["🪐", "🌍", "🌕", "🔴", "🌑", "⭐"], count: 6, motion: "orbit", size: [22, 32], dur: [3.2, 4.2] }] },
  tails: { parts: [{ glyph: ["✦"], count: 24, motion: "burst", colors: ["#fda4af", "#fde68a"], size: [8, 14], spread: 220, delay: 0.8 }], stage: "tails" },
  gates: { parts: [{ glyph: ["•", "✦"], count: 36, motion: "spiral", colors: ["#c4b5fd", "#67e8f9", "#fff"], size: [6, 12], dur: [1.8, 2.4] }], stage: "gates" },
  infinity: { parts: [{ glyph: ["✦"], count: 16, motion: "pop", colors: ["#5eead4", "#fff"], size: [10, 16], spread: 200, delay: 1.4 }], stage: "infinity" },
  eclipse: { parts: [{ glyph: ["•"], count: 40, motion: "burst", colors: ["#fef3c7", "#fde68a"], size: [3, 6], spread: 200, delay: 1.2 }], stage: "eclipse" },
  galaxy: { parts: [{ glyph: ["•", "✦", "·"], count: 70, motion: "spiral", colors: ["#a5b4fc", "#f0abfc", "#fff", "#fde68a"], size: [4, 10], dur: [2.4, 3.4] }], flash: "#ede9fe" },
  constellations: { parts: [{ glyph: ["✦"], count: 14, motion: "pop", colors: ["#fff", "#fde68a"], size: [10, 16], spread: 220 }], stage: "stars" },
};

function particles(p: Part): HTMLElement[] {
  return Array.from({ length: p.count }, (_, i) => {
    const n = el("i", { cls: "cel-p m-" + p.motion, textContent: pick(p.glyph), attrs: { "aria-hidden": "true" } });
    const a = (i / p.count) * Math.PI * 2 + rnd(-0.3, 0.3), r = rnd(0.45, 1) * (p.spread ?? 220);
    const s = n.style;
    s.setProperty("--x", `${Math.cos(a) * r}px`); s.setProperty("--y", `${Math.sin(a) * r}px`);
    s.setProperty("--a", `${(i / p.count) * 360}deg`); s.setProperty("--r", `${rnd(150, 230)}px`);
    s.setProperty("--l", `${rnd(0, 100)}%`); s.setProperty("--w", `${rnd(-60, 60)}px`);
    s.setProperty("--rot", `${rnd(-360, 360)}deg`);
    s.setProperty("--dur", `${rnd(...(p.dur ?? [1.2, 1.8]))}s`);
    s.setProperty("--d", `${(p.delay ?? 0) + (p.motion === "march" ? i * 0.12 : p.motion === "pop" ? i * 0.09 : p.motion === "rise" || p.motion === "rain" ? rnd(0, 1.6) : rnd(0, 0.25))}s`);
    s.fontSize = `${rnd(...(p.size ?? [12, 20]))}px`;
    if (p.colors) s.color = pick(p.colors);
    return n;
  });
}

function stage(kind: string, emoji: string): Element | null {
  const box = (cls: string, ...kids: (Node | string)[]) => el("div", { cls: "cel-stage s-" + cls, attrs: { "aria-hidden": "true" } }, ...kids);
  if (kind === "medal") return box("medal", el("span", { cls: "cel-medal", textContent: emoji }));
  if (kind === "crystal") return box("crystal", el("span", { textContent: "💎" }));
  if (kind === "trophy") return box("trophy", el("span", { textContent: "🏆" }));
  if (kind === "bolt") {
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", "0 0 200 200"); s.setAttribute("class", "cel-bolt");
    for (const d of ["M100 0 L85 70 L110 75 L80 200", "M30 20 L55 80 L40 85 L70 160", "M170 20 L150 90 L165 95 L135 170"]) { const p = document.createElementNS(SVG, "path"); p.setAttribute("d", d); s.append(p); }
    return box("bolt", s);
  }
  if (kind === "scroll") return box("scroll", el("div", { cls: "cel-scroll" }, el("i"), el("b"), el("i")));
  if (kind === "dragon") return box("dragon", el("span", { textContent: "🐉" }));
  if (kind === "crown") return box("crown", el("span", { textContent: "👑" }));
  if (kind === "chest") return box("chest", el("span", { cls: "cel-key", textContent: "🗝️" }), el("span", { cls: "cel-chest", textContent: "🧰" }), el("span", { cls: "cel-rays" }));
  if (kind === "comet") return box("comet", el("span", { textContent: "☄️" }));
  if (kind === "tails") return box("tails", ...Array.from({ length: 12 }, (_, i) => { const t = el("i"); t.style.setProperty("--i", String(i)); return t; }));
  if (kind === "gates") return box("gates", el("i", { cls: "g1" }), el("i", { cls: "g2" }), el("i", { cls: "g3" }));
  if (kind === "infinity") {
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", "0 0 200 100"); s.setAttribute("class", "cel-inf");
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", "M100 50 C70 10 20 10 20 50 C20 90 70 90 100 50 C130 10 180 10 180 50 C180 90 130 90 100 50 Z");
    p.setAttribute("pathLength", "100");
    s.append(p);
    return box("infinity", s);
  }
  if (kind === "eclipse") return box("eclipse", el("i", { cls: "sun" }), el("i", { cls: "moon" }));
  if (kind === "stars") {
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", "0 0 300 300"); s.setAttribute("class", "cel-stars");
    const pts = Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; const r = 90 + (i % 2) * 40; return [150 + Math.cos(a) * r, 150 + Math.sin(a) * r] as const; });
    pts.forEach(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length]!;
      const l = document.createElementNS(SVG, "line");
      for (const [k, v] of Object.entries({ x1: x, y1: y, x2: nx, y2: ny, pathLength: 100 })) l.setAttribute(k, String(v));
      l.style.setProperty("--d", `${0.2 + i * 0.15}s`);
      const c = document.createElementNS(SVG, "circle");
      for (const [k, v] of Object.entries({ cx: x, cy: y, r: 3.5 })) c.setAttribute(k, String(v));
      c.style.setProperty("--d", `${i * 0.15}s`);
      s.append(l, c);
    });
    return box("stars", s);
  }
  return null;
}

let open: (() => void) | null = null;
/** Shows the celebration; returns a function that closes it. */
export function celebrate(c: Celebration): () => void {
  open?.();
  const still = reduced();
  const fx = FX[c.effect] ?? FX.confetti!;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ok = el("button", { type: "button", cls: "btn primary", textContent: c.open ? "В коллекцию" : "Чудесно" });
  const later = c.open ? el("button", { type: "button", cls: "btn", textContent: "Закрыть" }) : null;
  const card = el("div", { cls: "cel-card", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Новая награда: " + c.title } },
    el("div", { cls: "cel-emoji", attrs: { "aria-hidden": "true" }, textContent: c.emoji }),
    el("div", { cls: "cel-tier", textContent: c.tierTitle + (c.medal ? " · " + c.medal : "") }),
    el("strong", { cls: "cel-title", textContent: c.title }),
    c.text ? el("p", { cls: "cel-text", textContent: c.text }) : null,
    c.more ? el("p", { cls: "cel-more", textContent: `И ещё наград: ${c.more}` }) : null,
    el("div", { cls: "cel-actions" }, ...(later ? [later] : []), ok));
  const layer = el("div", { cls: "cel-layer" }, ...(still ? [] : fx.parts.flatMap(particles)));
  const st = still || !fx.stage ? null : stage(fx.stage, c.emoji);
  const root = el("div", { cls: "cel fx-" + c.effect + (still ? " still" : "") },
    fx.flash && !still ? el("div", { cls: "cel-flash" }) : null, st, layer, card);
  root.style.setProperty("--tier", c.color);
  if (fx.flash) root.style.setProperty("--flash", fx.flash);
  const close = () => {
    if (!root.isConnected) return;
    document.removeEventListener("keydown", onKey, true);
    root.classList.add("out");
    setTimeout(() => root.remove(), still ? 0 : 220);
    if (open === close) open = null;
    if (opener?.isConnected) opener.focus();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  ok.addEventListener("click", () => { close(); c.open?.(); });
  later?.addEventListener("click", close);
  root.addEventListener("click", (e) => { if (e.target === root || e.target === layer) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(root);
  ok.focus();
  open = close;
  return close;
}
