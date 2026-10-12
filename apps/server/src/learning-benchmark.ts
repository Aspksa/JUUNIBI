/** Assessment-only learning benchmark. No model calls and no permission changes. */
export type AssessmentKind = "arithmetic" | "logic" | "transfer" | "structured";
export interface AssessmentRecord { kind: AssessmentKind; correct: boolean; phase: "practice" | "retry" | "retention" | "generalization" | "holdout"; at: string }
const kinds: AssessmentKind[] = ["arithmetic", "logic", "transfer", "structured"];
const phases: AssessmentRecord["phase"][] = ["practice", "retry", "retention", "generalization", "holdout"];
export class LearningBenchmark {
  private records: AssessmentRecord[] = [];
  load(data: unknown) {
    this.records = Array.isArray(data) ? data.filter((x): x is AssessmentRecord =>
      !!x && typeof x === "object" && kinds.includes(x.kind) && phases.includes(x.phase) &&
      typeof x.correct === "boolean" && typeof x.at === "string").slice(-500) : [];
  }
  record(kind: AssessmentKind, phase: AssessmentRecord["phase"], correct: boolean) {
    if (!kinds.includes(kind) || !phases.includes(phase) || typeof correct !== "boolean") return;
    this.records.push({kind, phase, correct, at:new Date().toISOString()});
    this.records = this.records.slice(-500);
  }
  snapshot() { return this.records.map(x => ({...x})); }
  summary() {
    const rate = (rows: AssessmentRecord[]) => rows.length ? Math.round(rows.filter(x=>x.correct).length * 100 / rows.length) : null;
    const groups = kinds.map(kind => {
      const rows = this.records.filter(x=>x.kind===kind);
      const independent = rows.filter(x=>x.phase==="holdout" || x.phase==="generalization");
      return {kind, attempts:rows.length, accuracy:rate(rows), independentAttempts:independent.length, independentAccuracy:rate(independent)};
    });
    const independent = this.records.filter(x=>x.phase==="holdout" || x.phase==="generalization");
    const first = independent.slice(0,Math.floor(independent.length/2));
    const last = independent.slice(Math.floor(independent.length/2));
    // Never claim improvement based on a few observations, self-assessment or practice repetitions.
    const sufficientEvidence = first.length>=20 && last.length>=20;
    return {total:this.records.length, practiceAccuracy:rate(this.records.filter(x=>x.phase==="practice")),
      independentAttempts:independent.length, independentAccuracy:rate(independent),
      firstHalfAccuracy:sufficientEvidence?rate(first):null,
      secondHalfAccuracy:sufficientEvidence?rate(last):null,
      observedChangePoints:sufficientEvidence ? rate(last)! - rate(first)! : null,
      sufficientEvidence, provenImprovement:false, // observational changes are not causal evidence
      groups};
  }
}
