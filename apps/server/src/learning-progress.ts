/** Deterministic performance metrics for bounded arithmetic assessments. */
export interface QuizAttempt { at: string; correct: boolean; level: number }
export class LearningProgress {
  private attempts: QuizAttempt[] = [];
  private level = 1;
  load(value: unknown) {
    if (!value || typeof value !== "object") return;
    const v = value as { attempts?: unknown; level?: unknown };
    if (Array.isArray(v.attempts)) this.attempts = v.attempts.filter((x): x is QuizAttempt =>
      !!x && typeof x === "object" && typeof x.at === "string" && typeof x.correct === "boolean" &&
      Number.isInteger(x.level) && x.level >= 1 && x.level <= 5).slice(-100);
    if (Number.isInteger(v.level) && Number(v.level) >= 1 && Number(v.level) <= 5) this.level = Number(v.level);
  }
  record(correct: boolean) {
    this.attempts.push({ at: new Date().toISOString(), correct, level: this.level });
    this.attempts = this.attempts.slice(-100);
    const recent = this.attempts.slice(-3);
    if (recent.length === 3 && recent.every(a => a.correct)) this.level = Math.min(5, this.level + 1);
    else if (!correct) this.level = Math.max(1, this.level - 1);
  }
  summary() {
    const total = this.attempts.length;
    const correct = this.attempts.filter(a => a.correct).length;
    const recent = this.attempts.slice(-10);
    return { total, correct, accuracy: total ? Math.round(correct / total * 100) : null,
      recentAccuracy: recent.length ? Math.round(recent.filter(a => a.correct).length / recent.length * 100) : null,
      difficulty: this.level, attempts: this.attempts.slice(-20).map(a => ({ ...a })) };
  }
  snapshot() { return { attempts: this.attempts.slice(-100), level: this.level }; }
  difficulty() { return this.level; }
}
