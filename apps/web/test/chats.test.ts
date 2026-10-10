import { describe, expect, it } from "vitest";
import { groupLabel, titleFrom, uid } from "../src/chat/chats";
import { webcrypto } from "node:crypto";

describe("titleFrom", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(titleFrom("  привет \n  мир ")).toBe("привет мир");
    const t = titleFrom("а".repeat(100));
    expect(t.length).toBe(48);
    expect(t.endsWith("…")).toBe(true);
  });
  it("falls back for empty input", () => { expect(titleFrom("   ")).toBe("Новый чат"); });
});

describe("groupLabel", () => {
  const now = new Date(2026, 9, 8, 15, 0);
  const day = (n: number) => new Date(2026, 9, 8 - n, 9, 0).getTime();
  it("groups like ChatGPT's history", () => {
    expect(groupLabel(day(0), now)).toBe("Сегодня");
    expect(groupLabel(now.getTime() + 3_600_000, now)).toBe("Сегодня");
    expect(groupLabel(day(1), now)).toBe("Вчера");
    expect(groupLabel(day(5), now)).toBe("Предыдущие 7 дней");
    expect(groupLabel(day(20), now)).toBe("Предыдущие 30 дней");
    expect(groupLabel(day(90), now)).toBe("Ранее");
  });
});

describe("uid", () => {
  it("works without crypto.randomUUID (phone on plain http)", () => {
    const insecure = { getRandomValues: <T extends ArrayBufferView | null>(a: T) => webcrypto.getRandomValues(a as Uint8Array) as T };
    const ids = new Set(Array.from({ length: 50 }, () => uid(insecure)));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
