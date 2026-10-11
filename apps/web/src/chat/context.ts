/** Keep the latest complete conversation turns inside the model input budget. */
export function recentContext(turns: { role: "user" | "assistant"; content: string }[], budget = 48_000) {
  const kept: typeof turns = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0 && kept.length < 60; i--) {
    const turn = turns[i]!;
    if (used + turn.content.length > budget) break;
    kept.unshift(turn);
    used += turn.content.length;
  }
  return kept;
}
