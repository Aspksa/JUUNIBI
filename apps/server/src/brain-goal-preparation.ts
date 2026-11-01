/** Safe, read-only preparation for the existing brain planning and approval workflow. */
export interface GoalInput {
  goal: string; context?: string; constraints?: string[];
  evidence?: { claim: string; source?: string; verified: boolean; reviewedAt?: string }[];
  outcomes?: { strategy: string; success: boolean; observedAt: string }[];
  feedback?: { strategy: string; rating: number }[];
}
export function prepareBrainGoal(input: GoalInput, now = Date.now()) {
  const goal = input.goal?.trim() ?? "";
  if (!goal || goal.length > 2000) throw new Error("Goal must be 1–2000 characters");
  const constraints = (input.constraints ?? []).filter(Boolean).slice(0, 20);
  const evidence = (input.evidence ?? []).slice(0, 100);
  const verified = evidence.filter(x => x.verified && !!x.source);
  const stale = verified.filter(x => !x.reviewedAt || !Number.isFinite(Date.parse(x.reviewedAt)) || now - Date.parse(x.reviewedAt) > 90 * 86_400_000);
  const claims = verified.map(x => x.claim.toLocaleLowerCase("ru").trim());
  const contradictions = verified.filter(x => {
    const claim = x.claim.toLocaleLowerCase("ru").trim();
    return claims.includes(claim.startsWith("не ") ? claim.slice(3) : "не " + claim);
  }).map(x => x.claim);
  const history = (input.outcomes ?? []).filter(x => Number.isFinite(Date.parse(x.observedAt)));
  const byStrategy = new Map<string, { success: number; failure: number; ratings: number[] }>();
  for (const x of history) {
    const s = byStrategy.get(x.strategy) ?? { success: 0, failure: 0, ratings: [] };
    if (x.success) s.success++; else s.failure++;
    byStrategy.set(x.strategy, s);
  }
  for (const x of input.feedback ?? []) {
    if (!Number.isFinite(x.rating) || x.rating < 1 || x.rating > 5) continue;
    const s = byStrategy.get(x.strategy) ?? { success: 0, failure: 0, ratings: [] };
    s.ratings.push(x.rating); byStrategy.set(x.strategy, s);
  }
  const strategies = [...byStrategy].map(([name, stats]) => ({
    name, ...stats, sampleSize: stats.success + stats.failure,
    estimatedSuccess: (stats.success + 1) / (stats.success + stats.failure + 2),
    meanRating: stats.ratings.length ? stats.ratings.reduce((a,b) => a+b, 0) / stats.ratings.length : null,
    recurringFailure: stats.failure >= 2
  })).sort((a,b) => b.estimatedSuccess - a.estimatedSuccess);
  const complexity = Math.min(10, 1 + Math.ceil(goal.length / 180) + constraints.length + (verified.length === 0 ? 2 : 0));
  const missing = [
    ...(!input.context?.trim() ? ["context"] : []),
    ...(verified.length === 0 ? ["verified-evidence"] : []),
    ...(constraints.length === 0 ? ["constraints"] : [])
  ];
  const steps = [
    { title: "Уточнить цель и критерии завершения", reason: "Без критериев нельзя доказать достижение цели" },
    { title: "Проверить знания, память и ограничения", reason: "Исключить устаревшие и неподтверждённые сведения" },
    { title: "Сравнить безопасные варианты", reason: "Учесть опыт, риски и оценки пользователя" },
    { title: "Предложить план на подтверждение", reason: "Исполнение требует разрешения владельца" },
    { title: "Проверить результат по критериям цели", reason: "Не путать завершение шагов с достижением цели" }
  ];
  return {
    goal, complexity, missing, verifiedCount: verified.length, staleClaims: stale.map(x => x.claim),
    potentialContradictions: [...new Set(contradictions)], strategies, steps,
    proposedNextStep: steps[0], requiresOwnerApproval: true, executesAutomatically: false,
    confidence: verified.length && !stale.length && !contradictions.length ? "evidence-informed" : "preliminary",
    note: "Рекомендации не исполняют инструменты и не изменяют сохранённые планы."
  };
}
