/** Fetches only curated public reference pages; never accepts arbitrary URLs or redirects.
 * A quote match is evidence, NOT an automatic truth determination.
 */
export type EvidenceResult = { source: string; quote: string; matched: boolean; retrievedAt: string };
const SOURCES: Record<string, string> = {
  nasa: "https://science.nasa.gov/",
  britannica: "https://www.britannica.com/",
  python: "https://docs.python.org/3/",
  mdn: "https://developer.mozilla.org/en-US/docs/Web/",
};
export async function checkPublicEvidence(
  source: unknown, section: unknown, quote: unknown,
  fetcher: typeof fetch = fetch,
): Promise<EvidenceResult> {
  if (typeof source !== "string" || !Object.hasOwn(SOURCES, source)) throw new Error("Источник не разрешён");
  if (typeof section !== "string" || !/^[a-zA-Z0-9_./-]{0,160}$/.test(section) ||
      section.includes("..") || section.startsWith("/") || section.includes("//"))
    throw new Error("Недопустимый раздел источника");
  if (typeof quote !== "string" || quote.trim().length < 30 || quote.length > 600)
    throw new Error("Укажите цитату 30–600 символов");
  const address = SOURCES[source] + section;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 7000);
  try {
    const response = await fetcher(address, { redirect: "error", signal: ac.signal, headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error("Источник недоступен");
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) throw new Error("Требуется HTML");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 350000) throw new Error("Документ слишком большой");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Нет содержимого");
    let received = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        received += part.value.byteLength;
        if (received > 350000) throw new Error("Превышен размер документа");
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const plain = new TextDecoder().decode(bytes).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    return { source: address, quote: quote.trim(), matched: normalize(plain).includes(normalize(quote)),
      retrievedAt: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}
