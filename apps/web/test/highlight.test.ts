import { describe, expect, it } from "vitest";
import { supportsLang, tokenize } from "../src/highlight";

const types = (code: string, lang: string) => tokenize(code, lang).filter((t) => t.t !== "plain").map((t) => `${t.t}:${t.v}`);
const joined = (code: string, lang: string) => tokenize(code, lang).map((t) => t.v).join("");

describe("highlight", () => {
  it("never loses or alters characters (round-trip) for every language family", () => {
    const samples: [string, string][] = [
      ["js", "const a = 'x\\'y' + `t${1}`; // c\n/* b */ foo(1.5e3, 0xFF);"], ["py", "def f(x):\n    return 'a' # c"], ["sh", "echo \"hi\" # c\ngit status"],
      ["sql", "SELECT * FROM t WHERE a = 'x' -- c"], ["json", '{"a": [1, true, null], "b": "c"}'], ["yaml", "a: 1\nb: 'x' # c"], ["css", "a { color: red; /* c */ }"],
      ["go", "func main() { fmt.Println(\"x\") }"], ["html", '<div class="a" id=b><!-- c --></div>'],
    ];
    for (const [lang, code] of samples) expect(joined(code, lang), lang).toBe(code);
  });
  it("classifies keywords, strings, numbers, comments and calls", () => {
    expect(types("const x = foo(42, 'a'); // hi", "ts")).toEqual(["kw:const", "fn:foo", "num:42", "str:'a'", "com:// hi"]);
    expect(types("def f(): return None  # c", "python")).toEqual(["kw:def", "fn:f", "kw:return", "kw:None", "com:# c"]);
    expect(types("select a from t", "SQL")).toEqual(["kw:select", "kw:from"]);
  });
  it("json keys differ from json string values", () => {
    expect(types('{"k": "v", "n": 7}', "json")).toEqual(['attr:"k"', 'str:"v"', 'attr:"n"', "num:7"]);
  });
  it("html tags, attributes, strings, comments", () => {
    expect(types('<a href="x"><!-- c --></a>', "html")).toEqual(["tag:<a", 'attr: href', 'str:"x"', "com:<!-- c -->", "tag:</a"]);
  });
  it("handles unterminated strings and comments without hanging", () => {
    expect(joined("'unterminated\nnext", "js")).toBe("'unterminated\nnext");
    expect(joined("/* open", "js")).toBe("/* open");
    expect(joined("`open template", "js")).toBe("`open template");
  });
  it("does not highlight an identifier suffix digit as a number", () => {
    expect(types("var1 = 2", "js")).toEqual(["num:2"]);
  });
  it("unknown languages and oversized input stay plain", () => {
    expect(tokenize("const a = 1", "brainfuck")).toEqual([{ t: "plain", v: "const a = 1" }]);
    expect(tokenize("a".repeat(30_000), "js")).toHaveLength(1);
    expect(supportsLang("TypeScript")).toBe(true);
    expect(supportsLang("klingon")).toBe(false);
  });
  it("is fast on adversarial input", () => {
    const t = Date.now();
    tokenize("'".repeat(8000) + "\n" + "/*".repeat(4000) + "\n" + "`".repeat(4000), "js");
    tokenize("<".repeat(15000), "html");
    expect(Date.now() - t).toBeLessThan(1500);
  });
});
