/** Tiny, dependency-free syntax highlighter. Pure (tokens only); the DOM is built by markdown.ts. Linear time, bounded input. */
export type TokType = "kw" | "str" | "num" | "com" | "fn" | "attr" | "tag" | "plain";
export interface Tok { t: TokType; v: string }

const MAX_CHARS = 20_000;
const w = (s: string) => new Set(s.split(/\s+/));
const JS = w("const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of void delete yield static get set this super null undefined true false interface type enum implements public private protected readonly as namespace declare abstract");
const PY = w("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield async await None True False global nonlocal del assert self");
const SH = w("if then else elif fi for while do done case esac function in echo cd export local return exit set unset source sudo npm git node python pip cat ls grep sed awk curl");
const SQL = w("select from where insert into values update set delete create table alter drop join left right inner outer on group by order having limit offset and or not null as distinct union primary key foreign references index default is in like between exists case when then else end");
const CLIKE = w("int long short char float double bool boolean void string struct enum class interface impl fn let mut pub use mod package import return if else for while do switch case break continue new this self null nil true false const static final public private protected extends implements func var go defer chan select range match trait where async await unsafe typedef namespace template typename virtual override");
const CSSK = w("important");

interface Lang { kw: Set<string>; line: string[]; block?: [string, string]; strQ: string; caseless?: boolean; calls?: boolean }
const LANGS: Record<string, Lang> = {
  js: { kw: JS, line: ["//"], block: ["/*", "*/"], strQ: "\"'`", calls: true },
  py: { kw: PY, line: ["#"], strQ: "\"'", calls: true },
  sh: { kw: SH, line: ["#"], strQ: "\"'" },
  sql: { kw: SQL, line: ["--"], block: ["/*", "*/"], strQ: "\"'", caseless: true },
  clike: { kw: CLIKE, line: ["//"], block: ["/*", "*/"], strQ: "\"'", calls: true },
  json: { kw: w("true false null"), line: [], strQ: "\"" },
  yaml: { kw: w("true false null yes no"), line: ["#"], strQ: "\"'" },
  css: { kw: CSSK, line: [], block: ["/*", "*/"], strQ: "\"'" },
};
const ALIAS: Record<string, string> = {
  js: "js", javascript: "js", jsx: "js", ts: "js", typescript: "js", tsx: "js", mjs: "js", node: "js",
  py: "py", python: "py", sh: "sh", bash: "sh", shell: "sh", zsh: "sh", powershell: "sh", ps1: "sh", bat: "sh",
  sql: "sql", json: "json", jsonc: "json", yaml: "yaml", yml: "yaml", css: "css", scss: "css",
  c: "clike", cpp: "clike", "c++": "clike", cs: "clike", csharp: "clike", java: "clike", kt: "clike", kotlin: "clike", go: "clike", golang: "clike", rs: "clike", rust: "clike", php: "clike", swift: "clike", dart: "clike",
  html: "html", xml: "html", svg: "html",
};
export const supportsLang = (lang: string) => lang.toLowerCase() in ALIAS;

const NUM = /0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENT = /[A-Za-z_$][\w$]*/y;

function push(out: Tok[], t: TokType, v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === t) last.v += v; else out.push({ t, v });
}

function tokenizeHtml(code: string): Tok[] {
  const out: Tok[] = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][^\s>/]*|\s[A-Za-z_:][\w:.-]*(?==)|"[^"\n]*"?|'[^'\n]*'?/y;
  let i = 0;
  while (i < code.length) {
    re.lastIndex = i;
    const m = re.exec(code);
    if (m && m.index === i) {
      const v = m[0];
      push(out, v.startsWith("<!--") ? "com" : v[0] === "<" ? "tag" : v[0] === '"' || v[0] === "'" ? "str" : "attr", v);
      i += v.length;
    } else { push(out, "plain", code[i]!); i++; }
  }
  return out;
}

export function tokenize(code: string, langName: string): Tok[] {
  const key = ALIAS[langName.toLowerCase()];
  if (!key || code.length > MAX_CHARS) return [{ t: "plain", v: code }];
  if (key === "html") return tokenizeHtml(code);
  const L = LANGS[key]!;
  const out: Tok[] = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i]!;
    // comments
    const lc = L.line.find((p) => code.startsWith(p, i));
    if (lc) { let e = code.indexOf("\n", i); if (e < 0) e = n; push(out, "com", code.slice(i, e)); i = e; continue; }
    if (L.block && code.startsWith(L.block[0], i)) {
      let e = code.indexOf(L.block[1], i + L.block[0].length); e = e < 0 ? n : e + L.block[1].length;
      push(out, "com", code.slice(i, e)); i = e; continue;
    }
    // strings (unterminated ones end at line end, except template literals)
    if (L.strQ.includes(c)) {
      let j = i + 1;
      while (j < n && code[j] !== c && (code[j] !== "\n" || c === "`")) { if (code[j] === "\\") j++; j++; }
      j = Math.min(n, code[j] === c ? j + 1 : j);
      const str = code.slice(i, j);
      // JSON keys / YAML-ish keys read better as attributes
      const isKey = (key === "json" || key === "yaml") && /^\s*:/.test(code.slice(j, j + 8));
      push(out, isKey ? "attr" : "str", str); i = j; continue;
    }
    // numbers
    if (/\d/.test(c) && !(i > 0 && /[\w$]/.test(code[i - 1]!))) {
      NUM.lastIndex = i; const m = NUM.exec(code);
      if (m && m.index === i) { push(out, "num", m[0]); i += m[0].length; continue; }
    }
    // identifiers
    if (/[A-Za-z_$]/.test(c)) {
      IDENT.lastIndex = i; const m = IDENT.exec(code)!;
      const word = m[0];
      const isKw = L.kw.has(L.caseless ? word.toLowerCase() : word);
      let type: TokType = "plain";
      if (isKw) type = "kw";
      else if (L.calls && code[i + word.length] === "(") type = "fn";
      else if (key === "css" && /^\s*:/.test(code.slice(i + word.length, i + word.length + 4))) type = "attr";
      push(out, type, word); i += word.length; continue;
    }
    push(out, "plain", c); i++;
  }
  return out;
}
