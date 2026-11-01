import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("assistant tool ownership wiring", () => {
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  it("assigns Brain tools to the existing registry owner", () => {
    const registrations = [...source.matchAll(/assistant\.tools\.register\(\{\s*name: "(brain_[a-z0-9_]+)"[\s\S]*?\n  \}, "brain"\);/g)];
    expect(registrations.length).toBeGreaterThanOrEqual(10);
    expect(new Set(registrations.map(x => x[1])).size).toBe(registrations.length);
    expect((source.match(/assistant\.tools\.register\(\{\s*name: "brain_/g) ?? []).length).toBe(registrations.length);
  });
  it("includes read-only capability overlap diagnostics in functional health checks", () => {
    expect(source).toContain('const capabilityAudit = { registered: assistant?.tools.capabilities().length ?? 0');
    expect(source).toContain('potentialOverlaps: assistant?.tools.potentialOverlaps() ?? []');
    expect(source).toContain('results, isolatedChecks, capabilityAudit, summary:');
  });
  it("assigns existing extra tools to the assistant module", () => {
    expect(source).toContain('assistant.tools.register(tool, "assistant")');
  });
});
