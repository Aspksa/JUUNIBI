import { describe, expect, it } from "vitest";
import { defaultSettings } from "./assistant-settings";
import { buildExtraTools } from "./assistant-tools";
import { Organizer } from "./organizer";
describe("unified intelligence preview", () => {
  it("offers existing brain and memory tools without executing writes", async () => {
    const tools = buildExtraTools({
      settings: () => defaultSettings({}),
      organizer: new Organizer("unused.json"),
      backupDir: "unused",
      brief: async () => ({} as never)
    });
    const tool = tools.find(x => x.name === "unified_intelligence_preview");
    expect(tool).toBeDefined();
    const result = await tool!.run({ goal: "Подготовить план", verifiedFacts: [
      { claim: "проект готов", source: "turn-1" },
      { claim: "не проект готов", source: "turn-2" }
    ], outcomes: [{ tool: "search_memory", ok: false }] }) as any;
    expect(result.executesAutomatically).toBe(false);
    expect(result.possibleContradictions).toHaveLength(2);
    expect(result.recommendations.find((x: any) => x.tool === "search_memory").failedCalls).toBe(1);
    expect(result.recommendations.find((x: any) => x.tool === "web_search").enabled).toBe(false);
  });
});
