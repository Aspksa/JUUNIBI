import { describe, expect, it, vi } from "vitest";
import { Memory } from "./memory";
import { RequestContextBuilder, nowLine } from "./request-context";
import { SessionHistory } from "./session-history";

const summaries = (value?: string) => ({ get: vi.fn(async () => value) });

describe("RequestContextBuilder", () => {
  it("uses client-held history as source of truth and includes memory/system context", async () => {
    const memory = new Memory();
    await memory.add("fact", "Пользователь любит чай", "active");
    const sessions = new SessionHistory(40);
    sessions.appendTurn("s", "server old", "server answer");
    const summary = summaries("Ранее обсуждали проект.");
    const builder = new RequestContextBuilder({
      memory,
      summaries: summary,
      sessions,
      prefs: () => ({ suggestions: "rules", summaries: true }),
      persona: "Ты — тестовый помощник.",
      instructions: () => "Отвечай строго.",
      now: () => new Date(2026, 9, 9, 5, 30),
      describeModules: () => [{ name: "brain" }],
      describeBrain: () => ({ mode: "analysis" }),
    });

    const result = await builder.prepare({
      text: "Расскажи про чай",
      session: "s",
      history: Array.from({ length: 24 }, (_, i) => ({
        role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
        content: "client " + i,
      })),
      brainGuidance: {
        needsPlanning: true,
        needsApproval: true,
        needsEvidenceReview: true,
        evidenceWarnings: ["warning"],
      },
    });

    expect(result.usesClientHistory).toBe(true);
    expect(result.history.at(-1)?.content).toBe("client 23");
    expect(result.history.some((message) => message.content === "server old")).toBe(false);
    expect(result.memoryTexts).toEqual(["Пользователь любит чай"]);
    expect(result.prefs).toEqual({ suggestions: "rules", summaries: true });
    expect(summary.get).toHaveBeenCalled();
    expect(String(result.messages[0]?.content)).toContain("Ты — тестовый помощник.");
    expect(String(result.messages[0]?.content)).toContain("Пользователь любит чай");
    expect(String(result.messages[0]?.content)).toContain("Ранее обсуждали проект.");
    expect(String(result.messages[1]?.content)).toContain("Сложная задача");
    expect(String(result.messages[1]?.content)).toContain("warning");
    expect(result.messages.at(-1)).toEqual({ role: "user", content: "Расскажи про чай" });
  });

  it("falls back to server session history only when client history is absent", async () => {
    const sessions = new SessionHistory(40);
    sessions.appendTurn("s", "server user", "server assistant");
    const builder = new RequestContextBuilder({
      memory: new Memory(),
      summaries: summaries(),
      sessions,
    });

    const absent = await builder.prepare({ text: "next", session: "s" });
    expect(absent.usesClientHistory).toBe(false);
    expect(absent.history.map((message) => message.content)).toEqual(["server user", "server assistant"]);

    const explicitEmpty = await builder.prepare({ text: "fresh", session: "s", history: [] });
    expect(explicitEmpty.usesClientHistory).toBe(true);
    expect(explicitEmpty.history).toEqual([]);
  });

  it("ephemeral requests without client history start clean and skip summaries", async () => {
    const sessions = new SessionHistory(40);
    sessions.appendTurn("s", "old", "answer");
    const summary = summaries("must not be used");
    const builder = new RequestContextBuilder({
      memory: new Memory(),
      summaries: summary,
      sessions,
      prefs: () => ({ suggestions: "smart", summaries: true }),
    });

    const result = await builder.prepare({ text: "eval", session: "s", ephemeral: true });
    expect(result.history).toEqual([]);
    expect(summary.get).not.toHaveBeenCalled();
    expect(result.messages.filter((message) => message.role !== "system")).toEqual([
      { role: "user", content: "eval" },
    ]);
  });

  it("nowLine keeps explicit date, time and timezone context", () => {
    expect(nowLine(new Date(2026, 9, 9, 5, 30))).toMatch(
      /^Сейчас: .*пятниц.*9 октября 2026.*05:30 \(UTC[+-]\d\d:\d\d\)\.$/,
    );
  });
});
