import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../src/markdown";

describe("inline", () => {
  it("bold, italic, strike, code", () => {
    expect(parseInline("a **b** *c* ~~d~~ `e`")).toEqual([
      { t: "text", v: "a " }, { t: "b", c: [{ t: "text", v: "b" }] }, { t: "text", v: " " }, { t: "i", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " }, { t: "s", c: [{ t: "text", v: "d" }] }, { t: "text", v: " " }, { t: "code", v: "e" },
    ]);
  });
  it("does not treat snake_case or lone asterisks as emphasis", () => {
    expect(parseInline("snake_case_name and 2 * 3 * 4")).toEqual([{ t: "text", v: "snake_case_name and 2 * 3 * 4" }]);
  });
  it("code spans protect their contents", () => {
    expect(parseInline("`**x**`")).toEqual([{ t: "code", v: "**x**" }]);
  });
  it("links: only http(s) and mailto become anchors; javascript: is dropped to text", () => {
    expect(parseInline("[ok](https://a.com/x)")).toEqual([{ t: "a", href: "https://a.com/x", c: [{ t: "text", v: "ok" }] }]);
    expect(parseInline("[bad](javascript:alert(1))")).toEqual([{ t: "text", v: "bad" }]);
    expect(parseInline("[bad](data:text/html;base64,AAAA)")).toEqual([{ t: "text", v: "bad" }]);
  });
  it("autolinks bare URLs without trailing punctuation", () => {
    expect(parseInline("см. https://example.com/a.")).toEqual([{ t: "text", v: "см. " }, { t: "a", href: "https://example.com/a", c: [{ t: "text", v: "https://example.com/a" }] }, { t: "text", v: "." }]);
  });
  it("keeps HTML as plain text (no raw HTML support)", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });
  it("handles unmatched markers without hanging", () => {
    expect(parseInline("**не закрыто")).toEqual([{ t: "text", v: "**не закрыто" }]);
  });
});

describe("blocks", () => {
  it("headings, paragraphs, hr", () => {
    const b = parseMarkdown("# Заголовок\n\nтекст\nещё\n\n---");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "hr"]);
  });
  it("fenced code keeps content verbatim, incl. markdown and blank lines", () => {
    const b = parseMarkdown("```ts\nconst a = **1**;\n\nreturn a;\n```\nпосле");
    expect(b[0]).toEqual({ t: "code", lang: "ts", text: "const a = **1**;\n\nreturn a;" });
    expect(b[1]!.t).toBe("p");
  });
  it("an unterminated fence (stream in progress) is still a code block", () => {
    expect(parseMarkdown("```py\nprint(1)")[0]).toEqual({ t: "code", lang: "py", text: "print(1)" });
  });
  it("lists: bullets, ordered with start, nested", () => {
    const b = parseMarkdown("- a\n- b\n  - c\n\n3. x\n4. y");
    expect(b[0]).toMatchObject({ t: "ul" });
    expect((b[0] as any).items).toHaveLength(2);
    expect((b[0] as any).items[1].sub.t).toBe("ul");
    expect(b[1]).toMatchObject({ t: "ol", start: 3 });
  });
  it("blockquote and table", () => {
    const b = parseMarkdown("> цитата\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(b[0]).toMatchObject({ t: "quote" });
    expect(b[1]).toMatchObject({ t: "table" });
    expect((b[1] as any).rows).toHaveLength(1);
  });
  it("empty and whitespace input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });
  it("pathological input stays fast", () => {
    const t = Date.now();
    parseMarkdown("*".repeat(5000) + "\n" + "[".repeat(3000) + "\n" + "`".repeat(3000) + "\n" + "_a".repeat(3000));
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
