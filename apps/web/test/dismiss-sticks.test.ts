import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Reminder } from "../src/api";
import { dropDismissed } from "../src/pages/tasks-model";

const mem = new Map<string, string>();
vi.stubGlobal("location", { hash: "" });
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
const suggestion = { name: "проведи", text: "Проведи анализ задачи", count: 4 };
vi.mock("../src/api", async (orig) => {
  const real = await orig<typeof import("../src/api")>();
  return { ...real, api: { ...real.api, suggestions: async () => ({ ok: true, value: [suggestion] }) } };
});

const rem = (id: string, status: Reminder["status"]): Reminder => ({ id, text: id, at: "2026-10-11T18:00:00.000Z", createdAt: "2026-10-11T18:00:00.000Z", status, source: "evening" });

describe("«Не надо» и «Готово» не возвращаются", () => {
  it("отклонённое предложение быстрой команды не приходит снова при следующем опросе сервера", async () => {
    const { app, dismissSuggestion, refreshSuggestions } = await import("../src/state");
    await refreshSuggestions();
    expect(app.get().repeatSuggestions.map((s) => s.name)).toEqual(["проведи"]);
    dismissSuggestion("проведи");
    expect(app.get().repeatSuggestions).toEqual([]);
    await refreshSuggestions(); // опрос каждые 20 секунд
    expect(app.get().repeatSuggestions).toEqual([]);
  });
  it("страница «Дела» отклоняет предложение тем же запоминающим способом", () => {
    const src = readFileSync(new URL("../src/pages/tasks.ts", import.meta.url), "utf8");
    expect(src).toMatch(/import \{[^}]*\bdismissSuggestion\b[^}]*\} from "\.\.\/state"/);
    expect(src).not.toMatch(/dismissSuggestion: \(name\) => app\.set/);
  });
  it("сработавшее напоминание после «Готово» скрыто, даже если сервер всё ещё считает его сработавшим", () => {
    const list = [rem("eve", "due"), rem("week", "due"), rem("other", "due")];
    const d = dropDismissed(list, new Set(["eve", "week"]));
    expect(d.shown.map((r) => r.id)).toEqual(["other"]);
    expect(d.resend).toEqual(["eve", "week"]);
    // сервер подтвердил: запоминать больше нечего
    const after = dropDismissed([rem("eve", "done"), rem("other", "due")], new Set(["eve", "week"]));
    expect(after.shown.map((r) => r.id)).toEqual(["eve", "other"]);
    expect(after.resend).toEqual([]);
    expect(after.keep).toEqual([]);
  });
});
