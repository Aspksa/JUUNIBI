import { afterEach, describe, expect, it, vi } from "vitest";
import { runDeepAgents } from "./deepagents-runner";

const initial = process.env.JUUNIBI_DEEPAGENTS_ENABLED;
afterEach(() => {
  if (initial === undefined) delete process.env.JUUNIBI_DEEPAGENTS_ENABLED;
  else process.env.JUUNIBI_DEEPAGENTS_ENABLED = initial;
});

describe("Deep Agents safety gates", () => {
  it("is disabled by default", async () => {
    delete process.env.JUUNIBI_DEEPAGENTS_ENABLED;
    await expect(runDeepAgents("audit")).rejects.toMatchObject({ status: 503 });
  });
  it("rejects invalid input before spawning Python", async () => {
    process.env.JUUNIBI_DEEPAGENTS_ENABLED = "1";
    await expect(runDeepAgents(" ")).rejects.toMatchObject({ status: 400 });
    await expect(runDeepAgents("a".repeat(4001))).rejects.toMatchObject({ status: 400 });
  });
});
