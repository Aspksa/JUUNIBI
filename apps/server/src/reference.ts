/**
 * Read-only lookups on ONE reference site (Russian Wikipedia), always with the source link.
 * Fixed host, no redirects, small timeouts and size limits; the model cannot pick the address.
 */
const HOST = "https://ru.wikipedia.org";
const MAX_BODY = 600_000;
const MAX_TEXT = 6000;
const fail = (message: string, status = 502) => Object.assign(new Error(message), { status });

async function getJson(url: URL, fetcher: typeof fetch): Promise<unknown> {
  if (url.origin !== HOST) throw fail("Адрес вне разрешённого справочника", 400);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetcher(url.toString(), { redirect: "error", signal: ac.signal, headers: { Accept: "application/json", "User-Agent": "JUUNIBI/1.0 (personal assistant)" } })
      .catch(() => { throw fail("Справочник не ответил"); });
    if (!r.ok) throw fail("Справочник недоступен: HTTP " + r.status);
    const reader = r.body?.getReader();
    if (!reader) throw fail("Пустой ответ справочника");
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > MAX_BODY) throw fail("Ответ справочника слишком большой"); chunks.push(p.value); } }
    finally { await reader.cancel().catch(() => {}); }
    try { return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch { throw fail("Справочник вернул не JSON"); }
  } finally { clearTimeout(timer); }
}
const api = (params: Record<string, string>) => { const u = new URL("/w/api.php", HOST); for (const [k, v] of Object.entries({ format: "json", formatversion: "2", ...params })) u.searchParams.set(k, v); return u; };
const pageUrl = (title: string) => `${HOST}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
const plain = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

export interface WikiHit { title: string; url: string; snippet: string }
export async function wikiSearch(query: unknown, fetcher: typeof fetch = fetch): Promise<WikiHit[]> {
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 200) throw fail("Запрос: от 2 до 200 символов", 400);
  const body = await getJson(api({ action: "query", list: "search", srsearch: query.trim(), srlimit: "5", srprop: "snippet" }), fetcher) as { query?: { search?: { title?: unknown; snippet?: unknown }[] } };
  const list = body?.query?.search;
  if (!Array.isArray(list)) return [];
  return list.flatMap((x) => typeof x?.title === "string" ? [{ title: x.title, url: pageUrl(x.title), snippet: typeof x.snippet === "string" ? plain(x.snippet).slice(0, 300) : "" }] : []);
}
export async function wikiRead(title: unknown, fetcher: typeof fetch = fetch): Promise<{ title: string; url: string; text: string; truncated: boolean } | null> {
  if (typeof title !== "string" || title.trim().length < 1 || title.length > 200 || /[\n\r\0<>[\]{}|]/.test(title)) throw fail("Некорректное название статьи", 400);
  const body = await getJson(api({ action: "query", prop: "extracts", explaintext: "1", exsectionformat: "plain", redirects: "1", titles: title.trim() }), fetcher) as { query?: { pages?: { title?: unknown; extract?: unknown; missing?: unknown }[] } };
  const page = body?.query?.pages?.[0];
  if (!page || page.missing || typeof page.extract !== "string" || !page.extract.trim()) return null;
  const t = typeof page.title === "string" ? page.title : title.trim();
  const text = page.extract.replace(/\n{3,}/g, "\n\n").trim();
  return { title: t, url: pageUrl(t), text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
}
