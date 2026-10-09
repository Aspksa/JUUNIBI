import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ManifestStore, fetchManifest, manifestHash, parseManifest } from "./module-manifest";

const ok = { name: "weather", title: "Погода", description: "Описание модуля погоды", version: "1.0.0", deps: ["memory"], permissions: ["read:memory"] };
describe("манифесты модулей", () => {
  it("принимает корректный и отбрасывает лишние поля", () => {
    const m = parseManifest({ ...ok, extra: "x" }, []);
    expect(m).toEqual(ok);
  });
  it("отклоняет код, плохие имена, версии и неизвестные права", () => {
    for (const bad of [{ ...ok, code: "alert(1)" }, { ...ok, script: "x" }, { ...ok, main: "x.js" }, { ...ok, name: "Bad Name" }, { ...ok, name: "../x" },
      { ...ok, version: "latest" }, { ...ok, permissions: ["fs:write"] }, { ...ok, description: "x" }, [], null, "x", { ...ok, source: "https://evil.com/x.json" }])
      expect(() => parseManifest(bad, [])).toThrow();
  });
  it("занятое имя — 409", () => { expect(() => parseManifest(ok, ["weather"])).toThrowError(expect.objectContaining({ status: 409 })); });
  it("хеш стабилен независимо от порядка ключей и меняется с содержимым", () => {
    const a = parseManifest(ok, []);
    const b = parseManifest(Object.fromEntries(Object.entries(ok).reverse()), []);
    expect(manifestHash(a)).toBe(manifestHash(b));
    expect(manifestHash({ ...a, version: "1.0.1" })).not.toBe(manifestHash(a));
    expect(manifestHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("установка требует точную контрольную сумму и не исполняет код", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-man-"));
    try {
      const store = new ManifestStore(path.join(dir, "m.json"), () => ["memory", "brain"]);
      const p = store.preview({ ...ok, permissions: ["network"] });
      expect(p.executable).toBe(false);
      expect(p.warnings.join(" ")).toContain("интернет");
      await expect(store.install({ ...ok, permissions: ["network"] }, "0".repeat(64))).rejects.toThrow(/Контрольная/);
      await store.install({ ...ok, permissions: ["network"] }, p.sha256.toUpperCase());
      expect(store.list()).toHaveLength(1);
      await expect(store.install({ ...ok, permissions: ["network"] }, p.sha256)).rejects.toMatchObject({ status: 409 }); // имя занято
      const again = new ManifestStore(path.join(dir, "m.json"), () => []);
      await again.load();
      expect(again.list()[0]!.name).toBe("weather");
      await again.remove("weather");
      await expect(again.remove("weather")).rejects.toMatchObject({ status: 404 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("загрузка только из репозитория JUUNIBI, без редиректов", async () => {
    for (const u of ["https://evil.com/a.json", "http://raw.githubusercontent.com/Aspksa/JUUNIBI/main/a.json", "https://raw.githubusercontent.com/Aspksa/JUUNIBI/../x", 5, "https://raw.githubusercontent.com/Aspksa/JUUNIBI/main/a.json?x=1"])
      await expect(fetchManifest(u, vi.fn() as never)).rejects.toMatchObject({ status: 400 });
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => { expect(init?.redirect).toBe("error"); return new Response(JSON.stringify(ok)); });
    expect(await fetchManifest("https://raw.githubusercontent.com/Aspksa/JUUNIBI/main/m.json", f as never)).toEqual(ok);
    const down = vi.fn(async () => { throw new Error("x"); });
    await expect(fetchManifest("https://raw.githubusercontent.com/Aspksa/JUUNIBI/main/m.json", down as never)).rejects.toMatchObject({ status: 502 });
    const big = vi.fn(async () => new Response("x".repeat(70_000)));
    await expect(fetchManifest("https://raw.githubusercontent.com/Aspksa/JUUNIBI/main/m.json", big as never)).rejects.toMatchObject({ status: 502 });
  });
});
