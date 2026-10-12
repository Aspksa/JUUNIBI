import { describe,it,expect } from "vitest";
import { evaluateStrategyCalibration } from "../src/brain-strategy-calibration";
describe("strategy calibration gate",()=>{
  it("does not silently activate baseline or unproven changes",()=>{
    const result=evaluateStrategyCalibration({successWeight:1,failureWeight:1,riskWeight:1});
    expect(result.accepted).toBe(false);
    expect(result.appliesAutomatically).toBe(false);
    expect(result.activation).toBe("manual-review-only");
    expect(result.baseline.safetyFailures).toBe(0);
  });
  it("cannot accept unsafe or unvalidated weights",()=>{
    expect(()=>evaluateStrategyCalibration({successWeight:NaN,failureWeight:1,riskWeight:1})).toThrow();
    expect(()=>evaluateStrategyCalibration({successWeight:1,failureWeight:1,riskWeight:-1})).toThrow();
    const result=evaluateStrategyCalibration({successWeight:5,failureWeight:0,riskWeight:0});
    expect(result.accepted).toBe(false);
  });
});
