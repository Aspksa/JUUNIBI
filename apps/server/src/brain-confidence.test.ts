import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("evidence-based confidence in tool outcomes", () => {
  it("does not claim stable behavior without enough samples", () => {
    const brain = new BrainCore(() => true);
    expect(brain.toolConfidence("read_file")).toMatchObject({samples:0,status:"insufficient-evidence",confidence:"unknown"});
    brain.observeToolOutcome({tool:"read_file",status:"ok",risk:"read",elapsedMs:5});
    expect(brain.toolConfidence("read_file").status).toBe("insufficient-evidence");
    expect(brain.toolConfidenceWarnings()).toEqual([]);
  });
  it("flags repeated errors and requires review instead of an unsupported success claim", () => {
    const brain = new BrainCore(() => true);
    for (const status of ["error","ok","error"] as const) {
      brain.observeToolOutcome({tool:"read_file",status,risk:"read",elapsedMs:4});
    }
    expect(brain.toolConfidence("read_file")).toMatchObject({samples:3,failed:2,status:"needs-review",confidence:"low"});
    expect(brain.toolConfidenceWarnings().map(x => x.tool)).toEqual(["read_file"]);
  });
  it("distinguishes denials from failures", () => {
    const brain = new BrainCore(() => true);
    for (const status of ["denied","denied","ok"] as const) brain.observeToolOutcome({tool:"write_file",status,risk:"write",elapsedMs:2});
    expect(brain.toolConfidence("write_file")).toMatchObject({denied:2,failed:0,status:"permission-blocked"});
  });
});
