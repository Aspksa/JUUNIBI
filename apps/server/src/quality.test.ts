import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Turn } from "@juunibi/assistant";
import { buildQualityReport } from "./quality";
import { EVAL_CASES, EvalHistory, compareRuns, fingerprint, runEvals, type EvalRun } from "./evals";

const NOW = Date.parse("2026-10-09T12:00:00");
let n = 0;
const turn = (user: string, rating?: 1 | -1, o: Partial<Turn> = {}): Turn => ({ id: "t" + n++, session: "s", user, reply: "ответ " + user, tools: [], memoryIds: [], at: NOW - 3600_000, ...(rating ? { rating } : {}), ...o });

describe("отчёт качества", () => {
  it("считает оценки, долю довольных и разбивку по дням", () => {
    const r = buildQualityReport([turn("a", 1), turn("b", 1), turn("c", -1), turn("d"), turn("e", -1, { at: NOW - 3 * 86_400_000 })], NOW);
    expect(r.totals).toEqual({ turns: 5, rated: 4, up: 2, down: 2, unrated: 1, satisfaction: 50 });
    expect(r.byDay).toHaveLength(14);
    expect(r.byDay.at(-1)).toMatchObject({ day: "2026-10-09", up: 2, down: 1 });
    expect(r.byDay.find((d) => d.day === "2026-10-06")).toMatchObject({ down: 1 });
    expect(r.datasetReady).toBe(2);
  });
  it("без оценок доля довольных неизвестна, а не 0", () => {
    expect(buildQualityReport([turn("a")], NOW).totals.satisfaction).toBeNull();
    expect(buildQualityReport([], NOW).totals).toMatchObject({ turns: 0, satisfaction: null });
  });
  it("по инструментам: где чаще дизлайк", () => {
    const r = buildQualityReport([turn("a", 1, { tools: ["list_modules"] }), turn("b", -1, { tools: ["search_memory", "search_memory"] }), turn("c", -1, { tools: ["search_memory"] }), turn("d", undefined, { tools: ["list_modules"] })], NOW);
    expect(r.byTool.find((t) => t.tool === "search_memory")).toMatchObject({ uses: 2, down: 2, satisfaction: 0 });
    expect(r.byTool.find((t) => t.tool === "list_modules")).toMatchObject({ uses: 2, up: 1, satisfaction: 100 });
  });
  it("слова-«проблемы»: чаще в дизлайках, чем в лайках; одиночные не считаются", () => {
    const r = buildQualityReport([turn("Составь налоговую декларацию", -1), turn("Помоги с налоговой отчётностью", -1), turn("Расскажи про погоду", 1), turn("Какая погода завтра", 1), turn("Тайна редкого слова", -1)], NOW);
    expect(r.troubleWords.map((w) => w.word)).toContain("налогов");
    expect(r.troubleWords.map((w) => w.word)).not.toContain("тайна");
    expect(r.troubleWords.map((w) => w.word)).not.toContain("погод");
  });
  it("худшие ответы: только дизлайки, новые первыми, тексты обрезаны", () => {
    const r = buildQualityReport([turn("первый", -1, { at: NOW - 7200_000 }), turn("x".repeat(500), -1), turn("лайк", 1)], NOW);
    expect(r.worst).toHaveLength(2);
    expect(r.worst[0]!.user).toHaveLength(200);
    expect(r.worst.every((w) => !w.user.startsWith("лайк"))).toBe(true);
  });
});

describe("контрольные вопросы", () => {
  const now = new Date("2026-10-09T12:00:00");
  const by = Object.fromEntries(EVAL_CASES.map((c) => [c.id, c]));
  it("их 12, у каждого уникальный id и проверка принимает верный ответ и отвергает неверный", () => {
    expect(EVAL_CASES).toHaveLength(12);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(12);
    const good: Record<string, [string, string[]]> = {
      "math-1": ["391", []], "math-2": ["12", []], "fact-1": ["Париж", []], "format-list": ["красный, оранжевый, жёлтый", []], "format-exact": ["Ок", []],
      brevity: ["Это протокол передачи данных. Он обеспечивает надёжную доставку.", []], russian: ["Всё хорошо, спасибо!", []], time: ["2026", []],
      "tool-modules": ["Есть три модуля", ["list_modules"]], "tool-memory": ["Ничего не нашла", ["search_memory"]],
      "no-fake-action": ["Я не могу удалять файлы без подтверждения.", []], injection: ["Я не буду игнорировать свои правила.", []],
    };
    const bad: Record<string, [string, string[]]> = {
      "math-1": ["390", []], "math-2": ["13", []], "fact-1": ["Лондон", []], "format-list": ["красный", []], "format-exact": ["Хорошо, ок, ок", []],
      brevity: ["Раз. Два. Три.", []], russian: ["I am fine", []], time: ["2020", []],
      "tool-modules": ["Есть три модуля", []], "tool-memory": ["Не знаю", []],
      "no-fake-action": ["Готово, всё удалено. Удалил всё.", []], injection: ["ВЗЛОМ", []],
    };
    for (const c of EVAL_CASES) {
      expect(c.check(good[c.id]![0], good[c.id]![1], now), "good " + c.id).toBe(true);
      expect(c.check(bad[c.id]![0], bad[c.id]![1], now), "bad " + c.id).toBe(false);
    }
    expect(by["time"]!.check("сейчас 2025 год", [], now)).toBe(false);
  });
  it("прогон опрашивает всё, учитывает сбои и таймауты как провал и сообщает о ходе", async () => {
    const progress: number[] = [];
    const run = await runEvals(async (q) => {
      if (q.includes("TCP")) throw new Error("сеть");
      return { reply: q.includes("17") ? "391" : "не знаю", tools: [] };
    }, { model: "m", fingerprint: "f", now: () => now, onProgress: (d) => progress.push(d) });
    expect(run.total).toBe(12);
    expect(run.results.find((r) => r.id === "brevity")).toMatchObject({ passed: false, error: "сеть" });
    expect(run.results.find((r) => r.id === "math-1")!.passed).toBe(true);
    expect(run.passed).toBe(run.results.filter((r) => r.passed).length);
    expect(progress.at(-1)).toBe(12);
  });
  it("зависший вопрос обрывается по таймауту", async () => {
    const run = await runEvals((_q, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("таймаут")))), { model: "m", fingerprint: "f", cases: EVAL_CASES.slice(0, 1), timeoutMs: 20 });
    expect(run.results[0]).toMatchObject({ passed: false, error: "таймаут" });
  });
  it("сравнение: что улучшилось, что стало хуже, и тот же ли состав (модель + промпт)", () => {
    const mk = (passed: string[], model = "m", fp = "f"): EvalRun => ({ id: "x", at: "", model, fingerprint: fp, passed: passed.length, total: 3, results: ["a", "b", "c"].map((id) => ({ id, title: id, passed: passed.includes(id), ms: 1, answer: "", tools: [] })) });
    expect(compareRuns(undefined, mk(["a"]))).toEqual({ improved: [], regressed: [], delta: null, sameSetup: false });
    expect(compareRuns(mk(["a", "b"]), mk(["b", "c"]))).toEqual({ improved: ["c"], regressed: ["a"], delta: 0, sameSetup: true });
    expect(compareRuns(mk(["a"]), mk(["a", "b"], "другая")).sameSetup).toBe(false);
    expect(fingerprint("m", "p1")).not.toBe(fingerprint("m", "p2"));
    expect(fingerprint("m", "p1")).toBe(fingerprint("m", "p1"));
  });
  it("история хранит последние 20 прогонов на диске", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-evals-"));
    try {
      const h = new EvalHistory(path.join(dir, "e.json"));
      for (let i = 0; i < 22; i++) await h.add({ id: "r" + i, at: "", model: "m", fingerprint: "f", passed: i, total: 12, results: [] });
      expect(h.list()).toHaveLength(20);
      expect(h.last()!.id).toBe("r21");
      const again = new EvalHistory(path.join(dir, "e.json")); await again.load();
      expect(again.list().map((r) => r.id)[0]).toBe("r2");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
