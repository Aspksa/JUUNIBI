import { tokenize } from "./highlight";

/** Small, safe Markdown renderer: parser -> AST (pure, tested) -> DOM nodes (never innerHTML). */

export type Inline =
  | { t: "text"; v: string } | { t: "code"; v: string }
  | { t: "b" | "i" | "s"; c: Inline[] } | { t: "a"; href: string; c: Inline[] };
export interface ListItem { c: Inline[]; sub?: Block }
export type Block =
  | { t: "p"; c: Inline[] } | { t: "h"; level: number; c: Inline[] } | { t: "hr" }
  | { t: "code"; lang: string; text: string }
  | { t: "ul" | "ol"; items: ListItem[]; start?: number }
  | { t: "quote"; c: Block[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] };

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!~|>]/.test(src[i + 1]!)) { text += src[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(src.slice(i));
      if (m) { flush(); out.push({ t: "code", v: m[2]!.replace(/^ (.*) $/, "$1") }); i += m[0].length; continue; }
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const dbl = src.startsWith(ch + ch, i);
      const len = dbl ? 2 : 1;
      if (ch === "~" && !dbl) { text += ch; i++; continue; }
      const close = findClose(src, i + len, ch.repeat(len), ch === "_");
      const prevWord = ch === "_" && i > 0 && /\w/.test(src[i - 1]!);
      if (close > i + len && !/^\s/.test(src[i + len] ?? " ") && !prevWord) {
        flush();
        out.push({ t: ch === "~" ? "s" : dbl ? "b" : "i", c: parseInline(src.slice(i + len, close)) });
        i = close + len; continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/.exec(src.slice(i));
      if (m) {
        flush();
        if (SAFE_URL.test(m[2]!)) out.push({ t: "a", href: m[2]!, c: parseInline(m[1]!) });
        else out.push({ t: "text", v: m[1]! });
        i += m[0].length; continue;
      }
    }
    if (ch === "h" && (src.startsWith("http://", i) || src.startsWith("https://", i)) && (i === 0 || /[\s(]/.test(src[i - 1]!))) {
      const m = /^https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"]/.exec(src.slice(i));
      if (m) { flush(); out.push({ t: "a", href: m[0], c: [{ t: "text", v: m[0] }] }); i += m[0].length; continue; }
    }
    text += ch; i++;
  }
  flush();
  return out;
}
function findClose(src: string, from: number, marker: string, wordBoundary: boolean): number {
  for (let j = from; j <= src.length - marker.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (src[j] === "`") { const e = src.indexOf("`", j + 1); if (e > 0) { j = e; continue; } }
    if (src.startsWith(marker, j) && !/\s/.test(src[j - 1] ?? "") && (!wordBoundary || !/\w/.test(src[j + marker.length] ?? ""))) {
      if (marker.length === 1 && src[j + 1] === marker) { j++; continue; }
      return j;
    }
  }
  return -1;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const splitRow = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));

export function parseMarkdown(src: string): Block[] {
  return parseLines(src.replace(/\r\n?/g, "\n").split("\n"));
}
function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const f = FENCE.exec(line);
    if (f) { // fenced code; an unterminated fence (still streaming) runs to the end
      const fence = f[1]!; const body: string[] = []; i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[i]!)) body.push(lines[i++]!);
      i++;
      blocks.push({ t: "code", lang: f[2] ?? "", text: body.join("\n") });
      continue;
    }
    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { blocks.push({ t: "h", level: h[1]!.length, c: parseInline(h[2]!) }); i++; continue; }
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ t: "hr" }); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^ {0,3}> ?/, ""));
      blocks.push({ t: "quote", c: parseLines(q) }); continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const head = splitRow(line).map(parseInline); i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) rows.push(splitRow(lines[i++]!).map(parseInline));
      blocks.push({ t: "table", head, rows }); continue;
    }
    const li = /^( {0,3})([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const base = li[1]!.length;
      const items: ListItem[] = [];
      const start = ordered ? parseInt(li[2]!, 10) : undefined;
      while (i < lines.length) {
        const m = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[i]!);
        if (!m || m[1]!.length > base + 1 || /\d/.test(m[2]!) !== ordered) break;
        const item: ListItem = { c: parseInline(m[3]!) };
        i++;
        const sub: string[] = [];
        while (i < lines.length && (/^ {2,}\S/.test(lines[i]!) || (!lines[i]!.trim() && /^ {2,}\S/.test(lines[i + 1] ?? "")))) sub.push(lines[i++]!.replace(/^ {2,4}/, ""));
        if (sub.length) item.sub = parseLines(sub).length === 1 ? parseLines(sub)[0]! : { t: "quote", c: parseLines(sub) };
        items.push(item);
        while (i < lines.length && !lines[i]!.trim() && /^( *)([-*+]|\d{1,9}[.)])\s+/.test(lines[i + 1] ?? "")) i++;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items, ...(start !== undefined && start !== 1 ? { start } : {}) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !FENCE.test(lines[i]!) && !/^ {0,3}(#{1,6}\s|>)/.test(lines[i]!) && !/^ {0,3}([-*+]|\d{1,9}[.)])\s+/.test(lines[i]!)) para.push(lines[i++]!);
    if (!para.length) { para.push(lines[i++]!); }
    blocks.push({ t: "p", c: parseInline(para.map((l, k) => (k < para.length - 1 ? l.replace(/ {2,}$/, "\u0000") : l)).join("\n").replace(/\u0000\n/g, "\u0000")) });
  }
  return blocks;
}

// ---------- DOM ----------
function inlineNodes(list: Inline[]): Node[] {
  return list.flatMap((n): Node[] => {
    switch (n.t) {
      case "text": return n.v.split("\u0000").flatMap((part, k, a) => [document.createTextNode(part.replace(/\n/g, " ")), ...(k < a.length - 1 ? [document.createElement("br")] : [])]);
      case "code": { const c = document.createElement("code"); c.textContent = n.v; return [c]; }
      case "b": case "i": case "s": { const e = document.createElement(n.t === "b" ? "strong" : n.t === "i" ? "em" : "del"); e.append(...inlineNodes(n.c)); return [e]; }
      case "a": { const a = document.createElement("a"); a.href = n.href; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.append(...inlineNodes(n.c)); return [a]; }
    }
  });
}
export const COLLAPSE_LINES = 22;
function codeBlock(b: Extract<Block, { t: "code" }>, collapse = false): HTMLElement {
  const wrap = document.createElement("div"); wrap.className = "md-code";
  const head = document.createElement("div"); head.className = "md-code-head";
  const dots = document.createElement("span"); dots.className = "md-dots"; dots.setAttribute("aria-hidden", "true"); dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  const lang = document.createElement("span"); lang.className = "md-lang"; lang.textContent = b.lang || "код";
  const copy = document.createElement("button"); copy.type = "button"; copy.className = "md-copy"; copy.textContent = "Копировать";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.text); copy.textContent = "Скопировано ✓"; copy.classList.add("done"); } catch { copy.textContent = "Не удалось"; }
    setTimeout(() => { copy.textContent = "Копировать"; copy.classList.remove("done"); }, 1600);
  });
  head.append(dots, lang, copy);
  const pre = document.createElement("pre"); const code = document.createElement("code");
  for (const t of tokenize(b.text, b.lang)) {
    if (t.t === "plain") code.append(document.createTextNode(t.v));
    else { const sp = document.createElement("span"); sp.className = "tok-" + t.t; sp.textContent = t.v; code.append(sp); }
  }
  pre.append(code);
  wrap.append(head, pre);
  const lines = b.text.split("\n").length;
  if (collapse && lines > COLLAPSE_LINES) {
    wrap.classList.add("collapsed");
    const more = document.createElement("button"); more.type = "button"; more.className = "md-more";
    more.textContent = `Показать ещё ${lines - COLLAPSE_LINES} строк`;
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", () => {
      const open = wrap.classList.toggle("collapsed") === false;
      more.textContent = open ? "Свернуть" : `Показать ещё ${lines - COLLAPSE_LINES} строк`;
      more.setAttribute("aria-expanded", String(open));
    });
    wrap.append(more);
  }
  return wrap;
}
function blockNode(b: Block, collapse = false): Node {
  switch (b.t) {
    case "p": { const p = document.createElement("p"); p.append(...inlineNodes(b.c)); return p; }
    case "h": { const h = document.createElement(`h${Math.min(6, b.level + 1)}` as "h2"); h.append(...inlineNodes(b.c)); return h; }
    case "hr": return document.createElement("hr");
    case "code": return codeBlock(b, collapse);
    case "quote": { const q = document.createElement("blockquote"); q.append(...b.c.map((x) => blockNode(x))); return q; }
    case "ul": case "ol": {
      const l = document.createElement(b.t); if (b.t === "ol" && b.start) l.setAttribute("start", String(b.start));
      for (const it of b.items) { const li = document.createElement("li"); li.append(...inlineNodes(it.c)); if (it.sub) li.append(blockNode(it.sub)); l.append(li); }
      return l;
    }
    case "table": {
      const wrap = document.createElement("div"); wrap.className = "md-table";
      const t = document.createElement("table"); const th = t.createTHead().insertRow();
      for (const c of b.head) { const e = document.createElement("th"); e.append(...inlineNodes(c)); th.append(e); }
      const tb = t.createTBody();
      for (const r of b.rows) { const tr = tb.insertRow(); for (const c of r) { const td = tr.insertCell(); td.append(...inlineNodes(c)); } }
      wrap.append(t); return wrap;
    }
  }
}
export function renderMarkdown(src: string): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(...parseMarkdown(src).map((b) => blockNode(b)));
  return f;
}

// ---------- incremental rendering (streaming) ----------
export interface BlockPlan { keep: number; replace: number; append: number; remove: number }
/**
 * Streaming appends to the tail, so everything before the first changed block can be reused as-is:
 * kept nodes are untouched (selection and scroll survive), changed ones are re-rendered in place,
 * only genuinely new ones animate in.
 */
export function planBlocks(prev: string[], next: string[]): BlockPlan {
  let keep = 0;
  while (keep < prev.length && keep < next.length && prev[keep] === next[keep]) keep++;
  const common = Math.min(prev.length, next.length);
  return { keep, replace: common - keep, append: Math.max(0, next.length - prev.length), remove: Math.max(0, prev.length - next.length) };
}

const SIGS = new WeakMap<HTMLElement, string[]>();
/** Renders Markdown into `host`, patching only what changed since the last call. `final` enables collapsing long code. */
export function renderMarkdownInto(host: HTMLElement, src: string, final = true): void {
  const blocks = parseMarkdown(src);
  const next = blocks.map((b) => JSON.stringify(b) + (final ? "|f" : ""));
  const prev = SIGS.get(host) ?? [];
  const plan = planBlocks(prev, next);
  const kids = Array.from(host.childNodes);
  for (let i = 0; i < plan.remove; i++) kids[prev.length - 1 - i]?.remove();
  for (let i = plan.keep; i < plan.keep + plan.replace; i++) {
    const fresh = blockNode(blocks[i]!, final);
    kids[i]!.replaceWith(fresh);
  }
  for (let i = prev.length; i < next.length; i++) {
    const n = blockNode(blocks[i]!, final);
    if (!final && n instanceof HTMLElement) n.classList.add("enter"); // only blocks that appear while streaming animate
    host.append(n);
  }
  SIGS.set(host, next);
}
