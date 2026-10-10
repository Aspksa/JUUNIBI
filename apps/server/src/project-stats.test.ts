import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectStats, cleanStats, recordStartup } from "./project-stats";

const sample = { version: 1, generatedAt: "2026-10-10T00:00:00Z", head: "abc", commits: 3, groups: [{ id: "care", title: "Надёжность" }],
  metrics: [{ id: "rescued", group: "care", emoji: "🧯", title: "Спасённые установки", hint: "Успешные откаты", value: "—", detail: "x" },
    { id: "hours", group: "life", emoji: "🕰️", title: "Часы", hint: "h", value: "17:00", detail: "", kind: "hours", series: [1, 2, "x"] }] };

describe("показатели проекта", () => {
  it("принимает только ожидаемую форму", () => {
    expect(cleanStats({ version: 2, metrics: [], groups: [] })).toBeNull();
    expect(cleanStats(null)).toBeNull();
    const c = cleanStats({ ...sample, metrics: [...sample.metrics, { id: 5 }, { id: "x", group: "g", value: "y".repeat(500), kind: "evil" }] })!;
    expect(c.metrics).toHaveLength(3);
    expect(c.metrics[1]!.series).toEqual([1, 2, 0]);
    expect(c.metrics[2]!.value).toHaveLength(60);
    expect(c.metrics[2]!.kind).toBeUndefined();
  });
  it("без git берёт показатели с GitHub, сохраняет копию и подставляет данные приложения", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "juunibi-stats-"));
    let calls = 0;
    const ok = (async () => { calls++; return new Response(JSON.stringify(sample)); }) as unknown as typeof fetch;
    const s = new ProjectStats(dir, path.join(dir, "data"), async () => ({ rescued: { value: "2", detail: "установок: 5" } }), ok);
    const d = await s.get();
    expect(d.source).toBe("github");
    expect(d.metrics[0]).toMatchObject({ value: "2", detail: "установок: 5" });
    await s.get();
    expect(calls).toBe(1); // cached for an hour
    expect(JSON.parse(await readFile(path.join(dir, "data", "project-stats.json"), "utf8")).head).toBe("abc");
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const offline = await new ProjectStats(dir, path.join(dir, "data"), undefined, down).get();
    expect(offline.source).toBe("saved");
    const empty = new ProjectStats(dir, path.join(dir, "nothing"), undefined, down);
    await expect(empty.get()).rejects.toMatchObject({ status: 503 });
  });
  it("помнит время запуска", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "juunibi-start-"));
    await recordStartup(dir, 900.4);
    expect(await recordStartup(dir, 700)).toEqual([900, 700]);
  });
});
