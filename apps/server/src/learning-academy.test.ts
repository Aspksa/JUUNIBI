import { describe, expect, it } from "vitest";
import { chooseLearningTopic } from "./learning-priorities";
import { LearningProgress } from "./learning-progress";
import { LearningBenchmark } from "./learning-benchmark";

describe("Fox Academy curriculum", () => {
  it("keeps exploration sessions and prefers urgent gaps", () => {
    const gaps=[{topic:"Память",priority:2},{topic:"Логика",priority:1}];
    expect(chooseLearningTopic("Обзор",gaps,5)).toBe("Обзор");
    expect(chooseLearningTopic("Обзор",gaps,1)).toBe("Память");
  });
  it("ignores malformed gaps and remains deterministic", () => {
    expect(chooseLearningTopic("Обзор",[{topic:"",priority:2},{topic:"X",priority:99}],2)).toBe("Обзор");
    const gaps=[{topic:"B",priority:2},{topic:"A",priority:1}];
    expect(chooseLearningTopic("Обзор",gaps,3)).toBe(chooseLearningTopic("Обзор",gaps,3));
  });
});
describe("Fox Academy progression", () => {
  it("promotes only after three verified consecutive successes at one level", () => {
    const p=new LearningProgress();
    p.record(true);p.record(true);expect(p.difficulty()).toBe(1);
    p.record(true);expect(p.difficulty()).toBe(2);
    p.record(true);expect(p.difficulty()).toBe(2);
    p.record(true);expect(p.difficulty()).toBe(2);
    p.record(true);expect(p.difficulty()).toBe(3);
    expect(p.summary().byLevel[0]?.attempts).toBe(3);
  });
  it("restores state and never scores non-boolean inputs", () => {
    const p=new LearningProgress();p.record(true);p.record(false);
    const restored=new LearningProgress(); restored.load(p.snapshot());restored.record("yes" as unknown as boolean);
    expect(restored.summary().total).toBe(2);
    expect(restored.snapshot()).toEqual(p.snapshot());
  });
});
describe("Fox Academy independent benchmark", () => {
  it("does not claim improvement from practice alone", () => {
    const b=new LearningBenchmark();
    for(let i=0;i<100;i++)b.record("arithmetic","practice",true);
    expect(b.summary().independentAccuracy).toBeNull();
    expect(b.summary().sufficientEvidence).toBe(false);
    expect(b.summary().provenImprovement).toBe(false);
  });
  it("reports observed holdout changes, not proven causal learning", () => {
    const b=new LearningBenchmark();
    for(let i=0;i<20;i++)b.record("logic","holdout",false);
    for(let i=0;i<20;i++)b.record("logic","holdout",true);
    expect(b.summary().observedChangePoints).toBe(100);
    expect(b.summary().provenImprovement).toBe(false);
    const copy=new LearningBenchmark();copy.load(b.snapshot());expect(copy.summary().total).toBe(40);
  });
});
