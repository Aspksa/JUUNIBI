import { describe, it, expect } from "vitest";
import { formatFunctionalHealthReport } from "../src/functional-health-report";

describe("deterministic functional health report", () => {
  it("renders actual statuses without a model", () => {
    const text = formatFunctionalHealthReport(JSON.stringify({ checkedAt:"2026-10-11T11:00:00.000Z",results:[{module:"brain",status:"PASS",durationMs:2,detail:"read ok"},{module:"mobile",status:"SKIPPED",durationMs:1,detail:"disabled"}]}));
    expect(text).toContain("| brain | PASS | 2 | read ok |");
    expect(text).toContain("| mobile | SKIPPED | 1 | disabled |");
    expect(text).toContain("PASS: 1");
    expect(text).not.toContain("update_completed");
  });
  it("fails closed on invalid data", () => {
    expect(formatFunctionalHealthReport("not JSON")).toContain("некорректный JSON");
    expect(formatFunctionalHealthReport("{}")).toContain("не вернула список");
  });
  it("escapes markdown table cell injection", () => {
    expect(formatFunctionalHealthReport(JSON.stringify({results:[{module:"brain|oops",status:"PASS",detail:"one\ntwo"}]}))).toContain("brain oops");
  });
});
