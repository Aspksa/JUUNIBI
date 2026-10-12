/** Independent assessment progress. Unknown or ungraded answers must never increase this score. */
export interface QuizAttempt { at: string; correct: boolean; level: number }
export class LearningProgress {
  private attempts: QuizAttempt[] = [];
  private level = 1;
  private lastPromotionAt = -1;
  load(value: unknown) {
    if (!value || typeof value !== "object") return;
    const v = value as { attempts?: unknown; level?: unknown; lastPromotionAt?: unknown };
    if (Array.isArray(v.attempts)) this.attempts = v.attempts.filter((x): x is QuizAttempt =>
      !!x && typeof x === "object" && typeof x.at === "string" && typeof x.correct === "boolean" &&
      Number.isInteger(x.level) && x.level >= 1 && x.level <= 5).slice(-100);
    if (Number.isInteger(v.level) && Number(v.level) >= 1 && Number(v.level) <= 5) this.level = Number(v.level);
    if (Number.isInteger(v.lastPromotionAt) && Number(v.lastPromotionAt) >= -1 &&
        Number(v.lastPromotionAt) <= this.attempts.length) this.lastPromotionAt = Number(v.lastPromotionAt);
  }
  record(correct: boolean) {
    if (typeof correct !== "boolean") return;
    this.attempts.push({ at: new Date().toISOString(), correct, level: this.level });
    this.attempts = this.attempts.slice(-100);
    // A promotion requires 3 *new* consecutive successes at the same level.
    const recent = this.attempts.slice(-3);
    const promotionsAllowed = this.lastPromotionAt < 0 || this.attempts.length - this.lastPromotionAt >= 3;
    if (recent.length === 3 && promotionsAllowed && recent.every(a => a.correct && a.level === this.level)) {
      if (this.level < 5) { this.level++; this.lastPromotionAt = this.attempts.length; }
    } else if (!correct) {
      // A failed assessment lowers the difficulty, not the lifetime accuracy.
      this.level = Math.max(1, this.level - 1);
      this.lastPromotionAt = this.attempts.length;
    }
  }
  summary() {
    const total = this.attempts.length;
    const correct = this.attempts.filter(a => a.correct).length;
    const recent = this.attempts.slice(-10);
    const byLevel = [1,2,3,4,5].map(level => {
      const attempts = this.attempts.filter(a => a.level === level);
      return {level, attempts:attempts.length, accuracy:attempts.length ? Math.round(attempts.filter(a=>a.correct).length / attempts.length * 100) : null};
    });
    return { total, correct, accuracy: total ? Math.round(correct / total * 100) : null,
      recentAccuracy: recent.length ? Math.round(recent.filter(a => a.correct).length / recent.length * 100) : null,
      difficulty: this.level, byLevel, attempts: this.attempts.slice(-20).map(a => ({ ...a })) };
  }
  snapshot() { return { attempts: this.attempts.slice(-100), level: this.level, lastPromotionAt:this.lastPromotionAt }; }
  difficulty() { return this.level; }
}
