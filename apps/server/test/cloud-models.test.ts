import { afterAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { defaultSettings, validateSettings } from "../src/assistant-settings";

describe("chat model settings", () => {
  const servers: http.Server[] = [];
  afterAll(() => { for (const s of servers) s.close(); });
  const open = async (cloudModels?: () => Promise<string[]>) => {
    const server = createApp({ assistant: undefined, modules: () => [], configured: { hint: "ключ" }, ...(cloudModels ? { cloudModels } : {}) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  };

  it("defaults to CLOUDRU_MODEL and validates model names", async () => {
    const base = defaultSettings({ CLOUDRU_MODEL: "x/Main", CLOUDRU_FALLBACK_MODEL: "y/Backup" });
    expect(base.chat).toEqual({ model: "x/Main", fallbackModel: "y/Backup", reasoning: true });
    expect(defaultSettings({}).chat.fallbackModel).toBe("");
    const next = await validateSettings({ chat: { model: " a/B ", fallbackModel: "", reasoning: false } }, base);
    expect(next.chat).toEqual({ model: "a/B", fallbackModel: "", reasoning: false });
    await expect(validateSettings({ chat: { model: "bad name;" } }, base)).rejects.toMatchObject({ status: 400 });
    await expect(validateSettings({ chat: { reasoning: "yes" } }, base)).rejects.toMatchObject({ status: 400 });
  });

  it("lists the models of the saved key and reports failures", async () => {
    const ok = await open(async () => ["a", "b"]);
    expect(await (await fetch(ok + "/api/cloudru/models")).json()).toEqual({ models: ["a", "b"] });
    const noKey = await open(async () => { throw Object.assign(new Error("Сначала укажите ключ Cloud.ru"), { status: 409 }); });
    const r = await fetch(noKey + "/api/cloudru/models");
    expect(r.status).toBe(409);
    const down = await open(async () => { throw new Error("Cloud.ru вернул 503"); });
    expect((await fetch(down + "/api/cloudru/models")).status).toBe(502);
  });
});
