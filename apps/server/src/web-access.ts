/**
 * Internet access for the assistant: web search (DuckDuckGo without a key, or Brave Search with the owner's key)
 * and reading a web page as plain text.
 *
 * Read-only and guarded: only http(s); addresses on this computer or the home network are refused (checked on
 * every DNS answer, so a name cannot be re-pointed at 127.0.0.1 between the check and the request); redirects are
 * re-checked; size, time and text length are limited. A page can be opened only if its address came from a search
 * result or from the owner's own message, so text on a web page cannot make the assistant send data to an address
 * of its choosing.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

const fail = (message: string, status = 502) => Object.assign(new Error(message), { status });
const MAX_BODY = 2_000_000;
const MAX_TEXT = 8000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (compatible; JUUNIBI/1.0; personal assistant)";

// ---------- which addresses are off limits ----------
const blocked = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const)
  blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b:1::", 48]] as const)
  blocked.addSubnet(a, p, "ipv6");
// 198.18.0.0/15 stays allowed on purpose: VPN clients in "fake-IP" mode answer every name with an address from it.

/** True for an address on the internet; false for this computer, the home or office network and reserved ranges. */
export function isPublicAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return !blocked.check(ip, "ipv4");
  if (v !== 6) return false;
  const lower = ip.toLowerCase();
  // IPv4 written as IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1) and NAT64 (64:ff9b::7f00:1) reach the same IPv4 address
  const m = /^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(lower);
  if (m) {
    const v4 = m[1] ?? [parseInt(m[2]!, 16) >> 8, parseInt(m[2]!, 16) & 255, parseInt(m[3]!, 16) >> 8, parseInt(m[3]!, 16) & 255].join(".");
    return isPublicAddress(v4);
  }
  return !blocked.check(ip, "ipv6");
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
function safeLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, "");
    const list = addrs as dns.LookupAddress[];
    if (!list.length || list.some((x) => !isPublicAddress(x.address))) return cb(Object.assign(new Error("PRIVATE_ADDRESS"), { code: "EPRIVATE" }), "");
    if (options.all) cb(null, list); else cb(null, list[0]!.address, list[0]!.family);
  });
}

/** Parses an address the model or a page gave us. Only http(s), no user:password. */
export function checkUrl(raw: unknown, allowPrivate = false): URL {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2000) throw fail("Адрес страницы: от 1 до 2000 символов", 400);
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw fail("Это не адрес веб-страницы", 400); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw fail("Открываются только адреса http и https", 400);
  if (u.username || u.password) throw fail("Адреса с логином и паролем не открываются", 400);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (allowPrivate) { u.hash = ""; return u; }
  if (net.isIP(host) && !isPublicAddress(host)) throw fail("Адреса этого компьютера и домашней сети закрыты", 400);
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home\.arpa$/i.test(host)) throw fail("Адреса этого компьютера и домашней сети закрыты", 400);
  u.hash = "";
  return u;
}

export interface Fetched { url: string; status: number; type: string; body: Buffer }
export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  /** Tests only: lets a local test server through the address check. */
  allowPrivate?: boolean;
}

function once(url: URL, o: FetchOpts): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    // `timeout` below is the idle time of the socket; this one caps the whole request, slow trickles included
    const total = setTimeout(() => req.destroy(fail("Сайт не ответил вовремя")), (o.timeoutMs ?? TIMEOUT_MS) * 1.5);
    const done = <T>(fn: (v: T) => void) => (v: T) => { clearTimeout(total); fn(v); };
    resolve = done(resolve); reject = done(reject);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "GET", agent: false, timeout: o.timeoutMs ?? TIMEOUT_MS,
      ...(o.allowPrivate ? {} : { lookup: safeLookup as unknown as typeof dns.lookup }),
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5", "accept-language": "ru,en;q=0.8", "accept-encoding": "gzip, deflate, br", ...o.headers },
    }, (res) => {
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const stream: Readable = enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks: Buffer[] = []; let size = 0;
      const max = o.maxBytes ?? MAX_BODY;
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > max) { req.destroy(); stream.destroy(); reject(fail("Страница слишком большая")); return; }
        chunks.push(c);
      });
      stream.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on("error", () => reject(fail("Не удалось прочитать ответ сайта")));
    });
    req.on("timeout", () => req.destroy(fail("Сайт не ответил вовремя")));
    req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "EPRIVATE" || e.message === "PRIVATE_ADDRESS" ? fail("Адреса этого компьютера и домашней сети закрыты", 400)
      : (e as { status?: number }).status ? e : e.code === "ENOTFOUND" ? fail("Сайт не найден: " + url.hostname) : fail("Сайт недоступен: " + (e.code ?? e.message))));
    req.end();
  });
}

/** GET with the address check on every hop of a redirect chain. */
export async function fetchSafe(raw: string | URL, o: FetchOpts = {}): Promise<Fetched> {
  let url = checkUrl(raw.toString(), o.allowPrivate);
  for (let hop = 0; ; hop++) {
    const r = await once(url, o);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (hop >= MAX_REDIRECTS) throw fail("Слишком много перенаправлений");
      url = checkUrl(new URL(r.headers.location, url).toString(), o.allowPrivate);
      continue;
    }
    return { url: url.toString(), status: r.status, type: String(r.headers["content-type"] ?? ""), body: r.body };
  }
}

// ---------- HTML to text ----------
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", deg: "°", times: "×", bull: "•", middot: "·", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€", shy: "" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
function decode(body: Buffer, type: string): string {
  const head = body.subarray(0, 2048).toString("latin1");
  const cs = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try { return new TextDecoder(cs.toLowerCase()).decode(body); } catch { return new TextDecoder("utf-8").decode(body); }
}
/** Readable text of an HTML page: no scripts, menus or markup; paragraphs and list items on their own lines. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, 300);
  let s = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|aside|form|button|select)\b[\s\S]*?<\/\1\s*>/gi, " ");
  // the main part of the page, when it marks one and it has real text
  const main = /<(article|main)\b[^>]*>([\s\S]*)<\/\1\s*>/i.exec(s)?.[2];
  if (main && main.replace(/<[^>]*>/g, "").trim().length > 400) s = main;
  s = s.replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(h[1-6])\b[^>]*>/gi, "\n\n## ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|header|ul|ol|table|tr|blockquote|pre|h[1-6]|dl|dt|dd|figure|figcaption)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<[^>]*>/g, "");
  const text = decodeEntities(s).replace(/[ \t\f\v ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

export interface PageText { url: string; title: string; text: string; truncated: boolean }
export async function readPage(raw: unknown, o: FetchOpts = {}): Promise<PageText> {
  const r = await fetchSafe(checkUrl(raw, o.allowPrivate), o);
  if (r.status >= 400) throw fail(`Сайт ответил ошибкой: HTTP ${r.status}`);
  const type = r.type.toLowerCase();
  if (type && !/text\/|html|xml|json/.test(type)) throw fail("Это не текстовая страница (" + type.split(";")[0] + "): такие файлы не открываются");
  const raw_ = decode(r.body, r.type);
  const { title, text } = /html|xml/.test(type) || /^\s*</.test(raw_) ? htmlToText(raw_) : { title: "", text: raw_.trim() };
  if (!text) throw fail("На странице нет текста: возможно, она строится скриптами");
  return { url: r.url, title, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
}

// ---------- search ----------
export interface SearchHit { title: string; url: string; snippet: string }
const MAX_HITS = 6;
const attr = (attrs: string, name: string) => decodeEntities(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs)?.slice(2).find((x) => x !== undefined) ?? "");
const plain = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/** Results of the DuckDuckGo HTML page (no key needed). Ads and DuckDuckGo's own links are skipped. */
export function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const cls = attr(m[1]!, "class");
    if (/\bresult__a\b/.test(cls)) {
      let href = attr(m[1]!, "href");
      if (href.startsWith("//")) href = "https:" + href;
      try {
        const u = new URL(href, "https://duckduckgo.com");
        if (/(^|\.)duckduckgo\.com$/.test(u.hostname)) { const real = u.searchParams.get("uddg"); if (!real) continue; href = real; }
        const target = new URL(href);
        if (target.protocol !== "http:" && target.protocol !== "https:") continue;
        hits.push({ title: plain(m[2]!).slice(0, 200), url: target.toString(), snippet: "" });
      } catch { continue; }
    } else if (/\bresult__snippet\b/.test(cls) && hits.length && !hits[hits.length - 1]!.snippet) hits[hits.length - 1]!.snippet = plain(m[2]!).slice(0, 400);
  }
  const seen = new Set<string>();
  return hits.filter((h) => h.title && !seen.has(h.url) && seen.add(h.url)).slice(0, MAX_HITS);
}

export interface SearchConfig { provider: "duckduckgo" | "brave"; braveKey: string }
export async function webSearch(query: unknown, cfg: SearchConfig, o: FetchOpts = {}): Promise<{ provider: string; results: SearchHit[] }> {
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 300) throw fail("Запрос: от 2 до 300 символов", 400);
  const q = query.trim();
  if (cfg.provider === "brave") {
    if (!cfg.braveKey) throw fail("Для Brave Search нужен ключ: укажите его в «Настройки → Инструменты»", 400);
    const u = new URL("https://api.search.brave.com/res/v1/web/search");
    u.searchParams.set("q", q); u.searchParams.set("count", String(MAX_HITS)); u.searchParams.set("search_lang", "ru");
    const r = await fetchSafe(u, { ...o, headers: { accept: "application/json", "x-subscription-token": cfg.braveKey } });
    if (r.status === 401 || r.status === 403) throw fail("Brave Search не принял ключ: проверьте его в настройках");
    if (r.status === 429) throw fail("Brave Search: исчерпан лимит запросов");
    if (r.status >= 400) throw fail("Brave Search недоступен: HTTP " + r.status);
    let body: { web?: { results?: { title?: unknown; url?: unknown; description?: unknown }[] } };
    try { body = JSON.parse(r.body.toString("utf8")); } catch { throw fail("Brave Search вернул не JSON"); }
    const results = (body.web?.results ?? []).flatMap((x) => typeof x.title === "string" && typeof x.url === "string" && /^https?:\/\//.test(x.url)
      ? [{ title: plain(x.title).slice(0, 200), url: x.url, snippet: typeof x.description === "string" ? plain(x.description).slice(0, 400) : "" }] : []).slice(0, MAX_HITS);
    return { provider: "Brave Search", results };
  }
  const u = new URL("https://html.duckduckgo.com/html/");
  u.searchParams.set("q", q); u.searchParams.set("kl", "ru-ru");
  const r = await fetchSafe(u, o);
  const html = r.body.toString("utf8");
  const results = parseDuckDuckGo(html);
  if (!results.length && (r.status === 202 || r.status === 403 || /anomaly|challenge/i.test(html)))
    throw fail("DuckDuckGo временно ограничил запросы. Повторите позже или подключите Brave Search в настройках");
  if (!results.length && r.status >= 400) throw fail("DuckDuckGo недоступен: HTTP " + r.status);
  return { provider: "DuckDuckGo", results };
}

// ---------- which pages may be opened ----------
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`«»()[\]{}]+/gi;
/** Addresses the assistant may open: ones the owner wrote and ones a search returned. Newest kept, oldest forgotten. */
export class OpenableUrls {
  private urls = new Map<string, number>();
  constructor(private readonly max = 500) {}
  private key(raw: string): string | null { try { const u = new URL(raw); u.hash = ""; return u.toString(); } catch { return null; } }
  add(raw: string) {
    const k = this.key(raw.replace(/[.,;:!?]+$/, ""));
    if (!k) return;
    this.urls.delete(k); this.urls.set(k, Date.now());
    while (this.urls.size > this.max) this.urls.delete(this.urls.keys().next().value!);
  }
  /** Remembers every link in a message the owner wrote. */
  noteText(text: string) { for (const m of text.slice(0, 200_000).matchAll(URL_IN_TEXT)) this.add(m[0]); }
  allowed(raw: string): boolean { const k = this.key(raw); return !!k && this.urls.has(k); }
}
