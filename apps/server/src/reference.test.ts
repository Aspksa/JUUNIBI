import { describe, expect, it, vi } from "vitest";
import { wikiRead, wikiSearch } from "./reference";

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
describe("справочник", () => {
  it("поиск возвращает название, ссылку на источник и очищенный отрывок", async () => {
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toMatch(/^https:\/\/ru\.wikipedia\.org\/w\/api\.php\?/);
      expect(init?.redirect).toBe("error");
      return json({ query: { search: [{ title: "Лисица обыкновенная", snippet: "<span class=\"searchmatch\">Лисица</span> &amp; другие" }, { nope: 1 }] } });
    });
    const r = await wikiSearch("лисица", f as never);
    expect(r).toEqual([{ title: "Лисица обыкновенная", url: "https://ru.wikipedia.org/wiki/%D0%9B%D0%B8%D1%81%D0%B8%D1%86%D0%B0_%D0%BE%D0%B1%D1%8B%D0%BA%D0%BD%D0%BE%D0%B2%D0%B5%D0%BD%D0%BD%D0%B0%D1%8F", snippet: "Лисица & другие" }]);
  });
  it("чтение статьи режет длинный текст и возвращает ссылку; отсутствующая статья — null", async () => {
    const f = vi.fn(async () => json({ query: { pages: [{ title: "Тест", extract: "а".repeat(9000) }] } }));
    const r = await wikiRead("тест", f as never);
    expect(r!.text).toHaveLength(6000);
    expect(r).toMatchObject({ truncated: true, url: "https://ru.wikipedia.org/wiki/%D0%A2%D0%B5%D1%81%D1%82" });
    expect(await wikiRead("нет", (async () => json({ query: { pages: [{ title: "Нет", missing: true }] } })) as never)).toBeNull();
  });
  it("плохие запросы отклоняются до обращения к сети", async () => {
    const f = vi.fn();
    for (const q of ["", "а", "x".repeat(201), 5]) await expect(wikiSearch(q, f as never)).rejects.toMatchObject({ status: 400 });
    for (const t of ["", "a\nb", "a|b", "<script>", "x".repeat(201), 5]) await expect(wikiRead(t, f as never)).rejects.toMatchObject({ status: 400 });
    expect(f).not.toHaveBeenCalled();
  });
  it("сетевые сбои, ошибки HTTP, не-JSON и огромные ответы — 502", async () => {
    await expect(wikiSearch("лиса", (async () => { throw new Error("x"); }) as never)).rejects.toMatchObject({ status: 502 });
    await expect(wikiSearch("лиса", (async () => new Response("", { status: 500 })) as never)).rejects.toMatchObject({ status: 502 });
    await expect(wikiSearch("лиса", (async () => new Response("<html>")) as never)).rejects.toMatchObject({ status: 502 });
    await expect(wikiSearch("лиса", (async () => new Response("x".repeat(700_000))) as never)).rejects.toMatchObject({ status: 502 });
  });
  it("пустой или неожиданный ответ — пустой результат, не падение", async () => {
    expect(await wikiSearch("лиса", (async () => json({})) as never)).toEqual([]);
    expect(await wikiRead("лиса", (async () => json({ query: {} })) as never)).toBeNull();
  });
});
