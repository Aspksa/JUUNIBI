import { describe, expect, it } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { OpenableUrls, checkUrl, fetchSafe, htmlToText, isPublicAddress, parseDuckDuckGo, readPage, webSearch } from "./web-access";
import { defaultSettings, instructionsPrompt, publicSettings, validateSettings } from "./assistant-settings";

async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("адреса", () => {
  it("закрыты этот компьютер, домашняя сеть и служебные диапазоны, открыт интернет", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:c0a8:101", "64:ff9b::7f00:1", "не адрес"])
      expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111", "::ffff:8.8.8.8", "198.18.0.5"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("checkUrl пропускает только http(s) без логина и не в локальную сеть", () => {
    expect(checkUrl(" https://example.com/a#x ").toString()).toBe("https://example.com/a");
    for (const bad of ["file:///etc/passwd", "ftp://x.ru", "javascript:alert(1)", "http://user:pw@example.com", "http://127.0.0.1:4173/api", "http://[::1]/", "http://localhost/", "http://router.local/", "не ссылка", "", 5])
      expect(() => checkUrl(bad), String(bad)).toThrow();
  });
});

describe("загрузка страниц", () => {
  it("локальный сервер закрыт, даже если адрес выглядит безобидно", async () => {
    const s = await serve((_q, r) => r.end("секрет"));
    try {
      await expect(fetchSafe(s.base)).rejects.toThrow(/закрыты/);
      await expect(fetchSafe(s.base.replace("127.0.0.1", "localhost"))).rejects.toThrow(/закрыты/);
    } finally { await s.close(); }
  });
  it("перенаправление проверяется на каждом шаге, сжатие и кодировка учитываются, размер ограничен", async () => {
    const page = "<html><head><title>Чай &amp; кофе</title><script>alert(1)</script></head><body><nav>меню</nav><h1>Чай</h1><p>Напиток&nbsp;из листьев.</p><ul><li>зелёный</li><li>чёрный</li></ul></body></html>";
    const s = await serve((q, r) => {
      if (q.url === "/go-local") { r.writeHead(302, { location: "http://[::1]:1/x" }); return r.end(); }
      if (q.url === "/go") { r.writeHead(301, { location: "/page" }); return r.end(); }
      if (q.url === "/big") { r.writeHead(200, { "content-type": "text/plain" }); return r.end("x".repeat(3_000_000)); }
      if (q.url === "/bin") { r.writeHead(200, { "content-type": "application/zip" }); return r.end("PK"); }
      if (q.url === "/cp1251") { r.writeHead(200, { "content-type": "text/plain; charset=windows-1251" }); return r.end(Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])); }
      r.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" });
      r.end(zlib.gzipSync(page));
    });
    const o = { allowPrivate: true };
    try {
      // without the test switch the redirect target on this computer is refused
      await expect(fetchSafe(new URL(s.base + "/go-local"))).rejects.toThrow(/закрыты/);
      const page_ = await readPage(s.base + "/go", o);
      expect(page_).toMatchObject({ url: s.base + "/page", title: "Чай & кофе", truncated: false });
      expect((await readPage(s.base + "/cp1251", o)).text).toBe("Привет");
      await expect(readPage(s.base + "/bin", o)).rejects.toThrow(/не текстовая/);
      const r = await fetchSafe(new URL(s.base + "/go"), o);
      expect(r.url).toBe(s.base + "/page");
      const { title, text } = htmlToText(r.body.toString("utf8"));
      expect(title).toBe("Чай & кофе");
      expect(text).toContain("## Чай");
      expect(text).toContain("Напиток из листьев.");
      expect(text).toContain("- зелёный\n- чёрный");
      expect(text).not.toMatch(/alert|меню/);
      await expect(fetchSafe(new URL(s.base + "/big"), o)).rejects.toThrow(/большая/);
    } finally { await s.close(); }
  });
});

describe("поиск", () => {
  it("разбирает выдачу DuckDuckGo: настоящие ссылки, фрагменты, без рекламы и повторов", () => {
    const html = `
      <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Реклама</a></div>
      <div class="result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fru.wikipedia.org%2Fwiki%2F%D0%A7%D0%B0%D0%B9&amp;rut=abc">Чай — <b>Википедия</b></a></h2>
        <a class="result__snippet" href="x">Напиток, получаемый &laquo;завариванием&raquo;</a></div>
      <div class="result"><a class="result__a" href="https://tea.example/about">О чае</a></div>
      <div class="result"><a class="result__a" href="https://tea.example/about">О чае</a></div>
      <div class="result"><a class="result__a" href="javascript:alert(1)">Плохая</a></div>`;
    expect(parseDuckDuckGo(html)).toEqual([
      { title: "Чай — Википедия", url: "https://ru.wikipedia.org/wiki/%D0%A7%D0%B0%D0%B9", snippet: "Напиток, получаемый «завариванием»" },
      { title: "О чае", url: "https://tea.example/about", snippet: "" },
    ]);
  });
  it("проверяет запрос и требует ключ для Brave", async () => {
    await expect(webSearch("x", { provider: "duckduckgo", braveKey: "" })).rejects.toMatchObject({ status: 400 });
    await expect(webSearch("чай", { provider: "brave", braveKey: "" })).rejects.toThrow(/ключ/);
  });
  it("открыть можно только ссылки владельца и из выдачи", () => {
    const u = new OpenableUrls(3);
    u.noteText("Прочитай https://news.example/a?id=1, пожалуйста, и (https://b.example/x).");
    expect(u.allowed("https://news.example/a?id=1")).toBe(true);
    expect(u.allowed("https://news.example/a?id=1#top")).toBe(true);
    expect(u.allowed("https://b.example/x")).toBe(true);
    expect(u.allowed("https://news.example/a?id=2")).toBe(false);
    for (const x of ["https://1.example/", "https://2.example/"]) u.add(x);
    expect(u.allowed("https://news.example/a?id=1")).toBe(false); // самая старая забыта
  });
});

describe("настройки: инструкции и поиск", () => {
  it("инструкции сохраняются, ограничены по длине и попадают в системное сообщение", async () => {
    const base = defaultSettings({});
    expect(instructionsPrompt(base)).toBe("");
    const s = await validateSettings({ instructions: { about: " Меня зовут Аня, я дизайнер. ", style: "Коротко, списками." } }, base);
    expect(s.instructions).toEqual({ about: "Меня зовут Аня, я дизайнер.", style: "Коротко, списками." });
    const p = instructionsPrompt(s);
    expect(p).toContain("Меня зовут Аня");
    expect(p).toContain("Коротко, списками.");
    expect(p).toMatch(/не дают разрешений/);
    await expect(validateSettings({ instructions: { about: "x".repeat(1501) } }, base)).rejects.toThrow(/1500/);
    await expect(validateSettings({ instructions: "текст" }, base)).rejects.toThrow();
  });
  it("Brave требует ключ, а ключ не уходит в браузер", async () => {
    const base = defaultSettings({});
    expect(base.webSearch.provider).toBe("duckduckgo");
    await expect(validateSettings({ webSearch: { provider: "brave" } }, base)).rejects.toThrow(/ключ/);
    const s = await validateSettings({ webSearch: { provider: "brave", braveKey: " BSA123 " } }, base);
    expect(s.webSearch).toEqual({ provider: "brave", braveKey: "BSA123" });
    // смена поставщика без ключа в запросе сохраняет ключ
    expect((await validateSettings({ webSearch: { provider: "duckduckgo" } }, s)).webSearch.braveKey).toBe("BSA123");
    const pub = publicSettings(s);
    expect(JSON.stringify(pub)).not.toContain("BSA123");
    expect(pub.webSearch).toEqual({ provider: "brave", braveKeySet: true });
    await expect(validateSettings({ webSearch: { provider: "google" } }, base)).rejects.toThrow();
  });
});
