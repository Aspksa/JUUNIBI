/** Adaptive, deterministic curriculum: favour confirmed gaps without starving other subjects. */
export interface LearningGap { topic: string; priority: number }
export function chooseLearningTopic(fallback: string, gaps: LearningGap[], turn: number): string {
  const valid = gaps.filter(g => typeof g?.topic === "string" &&
    g.topic.trim().length > 0 && g.topic.trim().length <= 80 &&
    Number.isInteger(g.priority) && (g.priority === 1 || g.priority === 2));
  if (!valid.length || !Number.isSafeInteger(turn) || turn < 0) return fallback;
  // Every fifth session remains exploratory, preventing a loop on one weak topic.
  if (turn % 5 === 0) return fallback;
  // Give high-priority gaps twice the curriculum weight; rotate to avoid monopolies.
  const unique = new Map<string, LearningGap>();
  for (const item of valid) {
    const name = item.topic.trim();
    const old = unique.get(name.toLocaleLowerCase("ru"));
    if (!old || old.priority < item.priority) unique.set(name.toLocaleLowerCase("ru"), {topic:name, priority:item.priority});
  }
  const weighted = [...unique.values()].sort((a,b)=>b.priority-a.priority || a.topic.localeCompare(b.topic,"ru"))
    .flatMap(g => Array.from({length:g.priority},()=>g.topic));
  return weighted[(turn - 1) % weighted.length] ?? fallback;
}
