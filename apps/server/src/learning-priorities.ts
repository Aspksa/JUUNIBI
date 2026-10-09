export function chooseLearningTopic(fallback: string, gaps: {topic: string; priority: number}[], turn: number): string {
  const valid = gaps.filter(g => typeof g.topic === 'string' && g.topic.length > 0 && g.topic.length <= 80 && (g.priority === 1 || g.priority === 2));
  valid.sort((a,b) => b.priority - a.priority);
  return valid.length && turn % 3 === 0 ? valid[turn % valid.length]!.topic : fallback;
}
