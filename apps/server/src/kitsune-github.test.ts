import { describe, expect, it, vi } from "vitest";
import { KitsuneGithub } from "./kitsune-github";

const SHA = "a".repeat(40);
describe("GitHub для Лисьего древа", () => {
  it("отдаёт только нужные поля PR и кэширует ответ", async () => {
    const githubGet = vi.fn(async () => [{ number: 5, title: "x", html_url: "https://github.com/Aspksa/JUUNIBI/pull/5", state: "closed", created_at: "c", merged_at: "m", head: { sha: SHA, repo: { secret: 1 } }, user: { login: "u" }, body: "long" }]);
    const g = new KitsuneGithub({ githubGet });
    const first = await g.pulls();
    expect(first).toEqual([{ number: 5, title: "x", html_url: "https://github.com/Aspksa/JUUNIBI/pull/5", state: "closed", created_at: "c", merged_at: "m", head: { sha: SHA } }]);
    await g.pulls();
    expect(githubGet).toHaveBeenCalledTimes(1);
    expect(githubGet).toHaveBeenCalledWith("/pulls?state=all&per_page=30");
  });
  it("не-массив вместо PR даёт пустой список", async () => {
    expect(await new KitsuneGithub({ githubGet: async () => ({ message: "x" }) }).pulls()).toEqual([]);
  });
  it("результаты CI: только статус, итог и дата; SHA проверяется", async () => {
    const githubGet = vi.fn(async () => ({ workflow_runs: [{ status: "completed", conclusion: "success", created_at: "t", actor: { login: "secret" }, head_commit: { message: "m" } }] }));
    const g = new KitsuneGithub({ githubGet });
    expect(await g.runs(SHA)).toEqual({ workflow_runs: [{ status: "completed", conclusion: "success", created_at: "t" }] });
    expect(githubGet).toHaveBeenCalledWith("/actions/runs?head_sha=" + SHA + "&per_page=5");
    await expect(g.runs("../../x")).rejects.toThrow(/SHA/);
    expect(githubGet).toHaveBeenCalledTimes(1);
  });
  it("ошибка GitHub не кэшируется", async () => {
    const githubGet = vi.fn().mockRejectedValueOnce(new Error("лимит")).mockResolvedValueOnce([]);
    const g = new KitsuneGithub({ githubGet });
    await expect(g.pulls()).rejects.toThrow("лимит");
    expect(await g.pulls()).toEqual([]);
  });
});
