import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SceneEngine, matchingScenePool } from "./scenes";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("emotion-aligned scenes", () => {
  it("matches real Russian scene and English phrase emotion labels", () => {
    const actions = [{ emotion: "защита" }, { emotion: "нежность" }, { emotion: "игривость" }];
    const phrases = [{ emotion: "protective" }, { emotion: "warm" }, { emotion: "playful" }];
    expect(matchingScenePool(actions, "anxiety")).toEqual([actions[0]]);
    expect(matchingScenePool(phrases, "anxiety")).toEqual([phrases[0]]);
    expect(matchingScenePool(actions, "tenderness")).toEqual([actions[1]]);
    expect(matchingScenePool(phrases, "tenderness")).toEqual([phrases[1]]);
    expect(matchingScenePool(actions, "playfulness")).toEqual([actions[2]]);
    expect(matchingScenePool(phrases, "playfulness")).toEqual([phrases[2]]);
    expect(matchingScenePool(actions, "unknown")).toEqual(actions);
  });

  it("prefers unused matching action and phrase then falls back without repeats", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "juunibi-scenes-"));
    dirs.push(root);
    const assets = path.join(root, "apps", "server", "assets");
    await mkdir(assets, { recursive: true });
    const actions = Array.from({ length: 365 }, (_, i) => ({
      id: "action-" + i, text: "Сцена номер " + i, category: "general",
      emotion: i === 0 ? "anxiety" : "calm",
    }));
    const phrases = Array.from({ length: 452 }, (_, i) => ({
      id: "phrase-" + i, text: "Фраза " + i, category: "general",
      emotion: i === 0 ? "anxiety" : "calm",
    }));
    await writeFile(path.join(assets, "JUUNIBI_365_cinematic_actions.json"), JSON.stringify({ actions }));
    await writeFile(path.join(assets, "JUUNIBI_452_phrases.json"), JSON.stringify({ phrases }));
    const engine = new SceneEngine(root, () => undefined);
    await engine.init();
    const first = await engine.next(undefined, "anxiety");
    expect(first.action.id).toBe("action-0");
    expect(first.phrase?.id).toBe("phrase-0");
    const second = await engine.next(undefined, "anxiety");
    expect(second.action.id).not.toBe(first.action.id);
    expect(second.phrase?.id).not.toBe(first.phrase?.id);
    expect(engine.stats().used).toBe(2);
  });
});
