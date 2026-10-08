import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

type Vars = Record<string, string>;
function block(css: string, startMarker: RegExp): Vars {
  const m = startMarker.exec(css);
  if (!m) throw new Error("block not found: " + startMarker);
  let i = css.indexOf("{", m.index) + 1, depth = 1;
  const start = i;
  while (depth && i < css.length) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; i++; }
  const body = css.slice(start, i - 1);
  const out: Vars = {};
  for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  return out;
}
const tokens = read("design/tokens.css");
const light: Vars = block(tokens, /^:root\{\s*\n\s*--bg:/m);
const darkVars: Vars = block(tokens, /^:root\[data-theme=dark\]/m);
const dark: Vars = { ...light, ...darkVars };

import { contrast as ratio } from "../src/design/contrast";
const contrast = (a: string, b: string) => ratio(a, b) ?? 0;

// foreground token, background token, minimum ratio (4.5 = AA text, 3 = AA large text / UI graphics)
const PAIRS: [string, string, number][] = [
  ["--fg", "--bg", 4.5], ["--fg", "--surface", 4.5], ["--fg", "--surface-2", 4.5],
  ["--muted", "--bg", 4.5], ["--muted", "--surface", 4.5], ["--muted", "--surface-2", 4.5],
  ["--accent-fg", "--accent", 4.5],
  ["--brand-fg", "--brand", 4.5],
  ["--brand-text", "--bg", 4.5], ["--brand-text", "--surface", 4.5],
  ["--danger", "--bg", 4.5], ["--danger", "--surface", 4.5], ["--danger", "--surface-2", 4.5],
  ["--danger-fg", "--danger", 4.5],
  ["--ok", "--bg", 4.5], ["--ok", "--surface", 4.5],
  ["--warn", "--bg", 4.5], ["--warn", "--surface", 4.5],
  ["--info", "--bg", 4.5], ["--info", "--surface", 4.5],
  ["--code-fg", "--code-bg", 4.5], ["--code-muted", "--code-head", 4.5],
  ["--brand", "--bg", 3], // focus ring / avatar ring (non-text, 3:1)
];

describe("design tokens: WCAG AA contrast in both themes", () => {
  for (const [name, vars] of [["light", light], ["dark", dark]] as const) {
    for (const [fg, bg, min] of PAIRS) {
      it(`${name}: ${fg} on ${bg} >= ${min}`, () => {
        const a = vars[fg], b = vars[bg];
        expect(a, fg).toMatch(/^#[0-9a-f]{3,6}$/i);
        expect(b, bg).toMatch(/^#[0-9a-f]{3,6}$/i);
        expect(contrast(a!, b!), `${fg} ${a} on ${bg} ${b}`).toBeGreaterThanOrEqual(min);
      });
    }
  }
  it("dark theme overrides exactly the same token names as the OS-preference dark block", () => {
    const media = block(tokens, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme=light\]\)/);
    expect(Object.keys(media).sort()).toEqual(Object.keys(darkVars).sort());
    for (const k of Object.keys(darkVars)) expect(media[k], k).toBe(darkVars[k]);
  });
});

describe("design system discipline", () => {
  const files = ["style.css", "design/base.css", "design/components.css"];
  it("no hard-coded colours outside tokens.css", () => {
    for (const f of files) {
      let css: string;
      try { css = read(f); } catch { continue; }
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const hits = stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? [];
      expect(hits, `${f} has literal colours: ${hits.join(", ")}`).toEqual([]);
    }
  });
  it("every var(--x) used in app CSS is defined in tokens.css", () => {
    const defined = new Set(Object.keys({ ...light, ...darkVars }).concat([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!)));
    for (const f of files) {
      let css: string;
      try { css = read(f); } catch { continue; }
      const local = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
      for (const m of css.matchAll(/var\((--[\w-]+)/g)) expect(defined.has(m[1]!) || local.has(m[1]!), `${f}: ${m[1]} is not a token`).toBe(true);
    }
  });
  it("z-index values come from tokens", () => {
    for (const f of files) {
      let css: string;
      try { css = read(f); } catch { continue; }
      const bad = [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => m[0]);
      expect(bad, `${f}: raw z-index`).toEqual([]);
    }
  });
  it("sources import the design CSS in order", () => {
    const main = read("main.ts");
    const order = ["design/tokens.css", "design/base.css", "design/components.css", "style.css"].map((f) => main.indexOf(f));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("readdir sanity: design folder exists", () => { expect(readdirSync(path.join(root, "design"))).toContain("tokens.css"); });
});
