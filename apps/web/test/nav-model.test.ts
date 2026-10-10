import { describe, expect, it } from "vitest";
import type { Brief } from "../src/api";
import {
  arrange, badges, cleanPrefs, hotkeyLabel, itemForDigit, move, placeBefore, recentChats, searchPalette, todayLine, toggleHidden, visibleItems,
  type PaletteEntry,
} from "../src/nav/model";

const ids = (p: ReturnType<typeof cleanPrefs>) => visibleItems(p).map((n) => n.id);
const brief = (o: Partial<Brief> = {}): Brief => ({ now: "", due: [], today: [], openTodos: { count: 0, first: [] }, plansRunning: 0, memoryPending: 0, modulesFailed: [], updateAvailable: false, attention: 0, ...o });

describe("menu prefs", () => {
  it("default: three groups, chat and tasks first, settings last", () => {
    const p = cleanPrefs(null);
    expect(arrange(p).map((g) => g.items.map((n) => n.id))).toEqual([["chat", "tasks"], ["brain", "modules"], ["mobile", "update", "settings"]]);
    expect(p.collapsed).toBe(false);
  });
  it("repairs stored junk: unknown ids dropped, missing ones added, settings never hidden", () => {
    const p = cleanPrefs({ collapsed: true, order: ["update", "nope", "update", 5], hidden: ["settings", "modules", "x"] });
    expect(p.collapsed).toBe(true);
    expect(p.order[0]).toBe("update");
    expect(new Set(p.order).size).toBe(7);
    expect(p.hidden).toEqual(["modules"]);
    expect(cleanPrefs("garbage")).toEqual(cleanPrefs(null));
  });
  it("moves an item inside its group only", () => {
    let p = cleanPrefs(null);
    p = move(p, "settings", -1);
    expect(arrange(p)[2]!.items.map((n) => n.id)).toEqual(["mobile", "settings", "update"]);
    expect(move(p, "chat", -1)).toBe(p); // already first
    expect(arrange(move(p, "tasks", -1))[0]!.items.map((n) => n.id)).toEqual(["tasks", "chat"]);
  });
  it("drag and drop places before a target of the same group, or last", () => {
    const p = cleanPrefs(null);
    expect(arrange(placeBefore(p, "settings", "mobile"))[2]!.items.map((n) => n.id)).toEqual(["settings", "mobile", "update"]);
    expect(arrange(placeBefore(p, "mobile", null))[2]!.items.map((n) => n.id)).toEqual(["update", "settings", "mobile"]);
    expect(placeBefore(p, "mobile", "chat")).toBe(p); // other group: ignored
  });
  it("hides and shows; hidden items leave the hotkeys", () => {
    const p = toggleHidden(cleanPrefs(null), "modules");
    expect(ids(p)).not.toContain("modules");
    expect(arrange(p, true)[1]!.items.map((n) => n.id)).toContain("modules");
    expect(hotkeyLabel(p, "mobile")).toBe("Alt+4");
    expect(toggleHidden(p, "modules").hidden).toEqual([]);
    expect(toggleHidden(p, "settings")).toBe(p);
  });
  it("Alt+digit follows the visible order and the physical key", () => {
    const p = cleanPrefs(null);
    expect(itemForDigit(p, "Digit1")?.id).toBe("chat");
    expect(itemForDigit(p, "Numpad2")?.id).toBe("tasks");
    expect(itemForDigit(p, "Digit8")).toBeNull();
    expect(itemForDigit(p, "KeyA")).toBeNull();
    expect(hotkeyLabel(p, "settings")).toBe("Alt+7");
  });
});

describe("counters", () => {
  const base = { brief: null, memory: [], modulesFailed: 0, updateAvailable: false, unread: 0, approvals: 0 };
  it("shows nothing when nothing needs you", () => { expect(badges(base)).toEqual({}); });
  it("counts fired reminders, pending memory, failed modules, updates and chat", () => {
    const b = badges({ ...base, brief: brief({ due: [{ id: "1", text: "Вода", at: "" }], memoryPending: 1 }),
      memory: [{ id: "a", kind: "fact", text: "x", status: "pending", score: 1 }, { id: "b", kind: "fact", text: "y", status: "pending", score: 1 }],
      modulesFailed: 1, updateAvailable: true, unread: 2 });
    expect(b.tasks).toMatchObject({ count: 1, tone: "accent" });
    expect(b.brain).toMatchObject({ count: 2 });
    expect(b.modules).toMatchObject({ tone: "bad" });
    expect(b.modules?.count).toBeUndefined();
    expect(b.update?.tone).toBe("bad");
    expect(b.chat).toMatchObject({ count: 2, tone: "accent" });
  });
  it("a decision waiting in the chat outranks unread answers", () => {
    expect(badges({ ...base, unread: 3, approvals: 1 }).chat).toMatchObject({ count: 1, tone: "bad" });
  });
});

describe("today line and recent chats", () => {
  const now = new Date(2026, 9, 10, 12, 0);
  const at = (h: number) => new Date(2026, 9, 10, h, 0).toISOString();
  it("fired first, else the nearest reminder still ahead", () => {
    expect(todayLine(null, now)).toBeNull();
    expect(todayLine(brief({ today: [{ id: "1", text: "Утро", at: at(9) }] }), now)).toBeNull();
    expect(todayLine(brief({ today: [{ id: "2", text: "Маме", at: at(19) }, { id: "3", text: "Стендап", at: at(15) }] }), now)).toMatchObject({ text: "Стендап", time: "15:00", due: false });
    expect(todayLine(brief({ due: [{ id: "4", text: "Вода", at: at(11) }], today: [{ id: "3", text: "Стендап", at: at(15) }] }), now)).toMatchObject({ text: "Вода", due: true });
  });
  it("newest chats with messages", () => {
    const c = (id: string, updatedAt: number, n = 1) => ({ id, updatedAt, messages: Array(n).fill(0) });
    expect(recentChats([c("a", 1), c("b", 5, 0), c("c", 3), c("d", 9), c("e", 2), c("f", 4)]).map((x) => x.id)).toEqual(["d", "f", "c", "e"]);
  });
});

describe("Ctrl+K search", () => {
  const e = (kind: PaletteEntry["kind"], title: string, terms?: string): PaletteEntry => ({ kind, title, icon: "chat", run: () => {}, ...(terms ? { terms } : {}) });
  const all = [e("command", "Новая беседа"), e("section", "Дела"), e("section", "Настройки"), e("chat", "Рецепт борща", "свёкла капуста"), e("task", "Позвонить маме"), e("memory", "Мама живёт в Казани")];
  it("empty text lists commands and sections only", () => {
    expect(searchPalette(all, " ").map((x) => x.title)).toEqual(["Новая беседа", "Дела", "Настройки"]);
  });
  it("every word must match; ё equals е; body text counts", () => {
    expect(searchPalette(all, "свекла").map((x) => x.title)).toEqual(["Рецепт борща"]);
    expect(searchPalette(all, "мам каз").map((x) => x.title)).toEqual(["Мама живёт в Казани"]);
    expect(searchPalette(all, "зzz")).toEqual([]);
  });
  it("a title that starts with the text comes first", () => {
    expect(searchPalette(all, "ма").map((x) => x.title)).toEqual(["Мама живёт в Казани", "Позвонить маме"]);
  });
  it("caps each kind", () => {
    const many = Array.from({ length: 10 }, (_, i) => e("chat", "Чат " + i));
    expect(searchPalette(many, "чат", 4)).toHaveLength(4);
  });
});

describe("Ctrl+K ties", () => {
  it("a section beats a command when both start with the text", () => {
    const e = (kind: PaletteEntry["kind"], title: string): PaletteEntry => ({ kind, title, icon: "chat", run: () => {} });
    expect(searchPalette([e("command", "Настроить меню"), e("section", "Настройки")], "наст")[0]!.title).toBe("Настройки");
  });
});
