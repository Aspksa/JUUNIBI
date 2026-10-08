import { describe, expect, it } from "vitest";
import { COMMANDS, MAX_FILES, MAX_FILE_BYTES, chatToMarkdown, checkFile, clampRect, fenceFor, formatBytes, isTextFile, looksBinary, parseCommand, resizeRect, safeFileName, speechText, stepLabel, suggestCommands, withFiles } from "../src/chat/helpers";
import type { Conversation } from "../src/chat/chats";

describe("slash commands", () => {
  it("parses commands with arguments, case-insensitively, in both languages", () => {
    expect(parseCommand("/запомни  кофе без сахара ")).toMatchObject({ command: { id: "remember" }, arg: "кофе без сахара" });
    expect(parseCommand("/NEW")).toMatchObject({ command: { id: "new" }, arg: "" });
    expect(parseCommand("/remember a\nb")).toMatchObject({ arg: "a\nb" });
  });
  it("unknown commands and plain text are not commands (sent as a normal message)", () => {
    expect(parseCommand("/неизвестно")).toBeNull();
    expect(parseCommand("привет /новый")).toBeNull();
    expect(parseCommand("/")).toBeNull();
  });
  it("palette suggests while the first word is typed, and only then", () => {
    expect(suggestCommands("/").length).toBe(COMMANDS.length);
    expect(suggestCommands("/за").map((c) => c.id)).toEqual(["remember"]);
    expect(suggestCommands("/эк").map((c) => c.id)).toEqual(["export"]);
    expect(suggestCommands("/запомни текст")).toEqual([]);
    expect(suggestCommands("текст")).toEqual([]);
  });
  it("every command id is unique and has a Russian and an English name", () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    for (const c of COMMANDS) expect(c.names.length).toBeGreaterThanOrEqual(2);
  });
});

describe("attachments", () => {
  const ok = { name: "a.ts", size: 100, type: "" };
  it("accepts text/code by mime or extension, rejects binaries", () => {
    expect(isTextFile("a.py", "")).toBe(true);
    expect(isTextFile("readme", "text/plain")).toBe(true);
    expect(isTextFile("x.png", "image/png")).toBe(false);
    expect(isTextFile("x.exe", "application/octet-stream")).toBe(false);
    expect(isTextFile(".gitignore", "")).toBe(true);
  });
  it("detects binary content disguised as text", () => {
    expect(looksBinary("abc\u0000def")).toBe(true);
    expect(looksBinary("�".repeat(50) + "a".repeat(100))).toBe(true);
    expect(looksBinary("обычный текст ✓")).toBe(false);
  });
  it("enforces count, size, total and duplicates with a reason", () => {
    expect(checkFile(ok, [])).toBeNull();
    expect(checkFile({ ...ok, size: MAX_FILE_BYTES + 1 }, [])).toMatch(/больше/);
    expect(checkFile({ ...ok, size: 0 }, [])).toMatch(/пустой/);
    expect(checkFile({ name: "p.png", size: 5, type: "image/png" }, [])).toMatch(/текстовые/);
    const have = Array.from({ length: MAX_FILES }, (_, i) => ({ name: `f${i}`, size: 10, text: "x" }));
    expect(checkFile(ok, have)).toMatch(/не больше/);
    expect(checkFile(ok, [{ name: "a.ts", size: 100, text: "" }])).toMatch(/уже/);
    expect(checkFile({ ...ok, size: 90_000 }, [{ name: "b", size: 90_000, text: "" }, { name: "c", size: 90_000, text: "" }])).toMatch(/суммарно/);
  });
  it("fence is always longer than any backtick run inside the file", () => {
    expect(fenceFor("no ticks")).toBe("```");
    expect(fenceFor("a ``` b")).toBe("````");
    expect(fenceFor("`````x")).toBe("``````");
  });
  it("withFiles labels every file and a file cannot break out of its block", () => {
    const text = withFiles("Объясни", [{ name: "a.md", size: 2048, text: "```js\nx\n```" }]);
    expect(text).toContain("Объясни");
    expect(text).toContain("Файл «a.md» (2.0 КБ)");
    expect(text).toContain("````\n```js\nx\n```\n````");
    expect(withFiles("только текст", undefined)).toBe("только текст");
    expect(withFiles("", [{ name: "x", size: 1, text: "y" }]).startsWith("Файл")).toBe(true);
  });
  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 Б"); expect(formatBytes(2048)).toBe("2.0 КБ"); expect(formatBytes(150 * 1024)).toBe("150 КБ"); expect(formatBytes(3 * 1048576)).toBe("3.0 МБ");
  });
});

describe("tool step labels", () => {
  it("friendly names for known tools, quoted name otherwise", () => {
    expect(stepLabel("list_modules")).toBe("Смотрю модули проекта");
    expect(stepLabel("custom_x")).toBe("Использую «custom_x»");
  });
});

describe("window geometry", () => {
  const vw = 1200, vh = 800;
  it("clamp keeps the window inside the viewport and above the minimum size", () => {
    expect(clampRect({ x: -50, y: -9, w: 3000, h: 3000 }, vw, vh)).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
    expect(clampRect({ x: 1100, y: 700, w: 600, h: 500 }, vw, vh)).toEqual({ x: 600, y: 300, w: 600, h: 500 });
    expect(clampRect({ x: 0, y: 0, w: 10, h: 10 }, vw, vh)).toMatchObject({ w: 520, h: 420 });
  });
  it("resize from the north-west keeps the opposite corner fixed", () => {
    const r = { x: 400, y: 300, w: 600, h: 400 };
    const n = resizeRect(r, "nw", -100, -50, vw, vh);
    expect(n).toEqual({ x: 300, y: 250, w: 700, h: 450 });
    expect(n.x + n.w).toBe(r.x + r.w); expect(n.y + n.h).toBe(r.y + r.h);
  });
  it("resize stops at the minimum size and the viewport edge", () => {
    const r = { x: 400, y: 300, w: 600, h: 400 };
    expect(resizeRect(r, "se", -500, -500, vw, vh)).toMatchObject({ w: 520, h: 420, x: 400, y: 300 });
    expect(resizeRect(r, "se", 5000, 5000, vw, vh)).toMatchObject({ w: 800, h: 500 });
    const w = resizeRect(r, "w", 5000, 0, vw, vh);
    expect(w.w).toBe(520); expect(w.x + w.w).toBe(1000);
    const nn = resizeRect(r, "n", 0, -5000, vw, vh);
    expect(nn.y).toBe(0); expect(nn.y + nn.h).toBe(700);
  });
});

describe("export", () => {
  const conv: Conversation = { id: "1", title: "Тест / чат?", createdAt: 0, updatedAt: 0, messages: [
    { id: "a", role: "user", content: "Привет", at: 0, files: [{ name: "n.txt", size: 3, text: "abc" }] },
    { id: "b", role: "assistant", content: "Здравствуйте", at: 0 },
    { id: "c", role: "note", content: "Запомнено: чай", at: 0 },
    { id: "d", role: "assistant", content: "", error: "сеть", at: 0 }] };
  it("renders a readable Markdown transcript", () => {
    const md = chatToMarkdown(conv, new Date(2026, 9, 8, 12, 0));
    expect(md).toContain("# Тест / чат?");
    expect(md).toContain("## Вы\n\n📎 n.txt (3 Б)\n\nПривет");
    expect(md).toContain("## JUUNIBI\n\nЗдравствуйте");
    expect(md).toContain("> Запомнено: чай");
    expect(md).toContain("_Ошибка: сеть_");
  });
  it("makes safe file names", () => {
    expect(safeFileName("Тест / чат?")).toBe("Тест чат.md");
    expect(safeFileName("???")).toBe("chat.md");
    expect(safeFileName("а".repeat(200)).length).toBe(63);
  });
});

describe("speechText", () => {
  it("drops markdown syntax, announces code, shortens links", () => {
    expect(speechText("## Заголовок\n\nЭто **важно** и `код`.\n\n- пункт\n\n```js\nsecret()\n```\nСм. [сайт](https://a.com) и https://b.com/x")).toBe("Заголовок Это важно и код. пункт Блок кода. См. сайт и ссылка");
    expect(speechText("а".repeat(10_000)).length).toBe(4000);
    expect(speechText("```py\nunterminated")).toBe("Блок кода.");
  });
});
