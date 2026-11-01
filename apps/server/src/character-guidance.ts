/** Adapt the existing versioned character profile to a bounded, stable persona prompt. */
export function characterGuidance(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const profile = raw as Record<string, unknown>;
  const personality = profile.personality as Record<string, unknown> | undefined;
  const behavior = profile.behavior as Record<string, unknown> | undefined;
  const traits = Array.isArray(personality?.traits) ? personality.traits : [];
  const principles = Array.isArray(behavior?.principles) ? behavior.principles : [];
  const contexts = behavior?.contexts;
  const entries = traits.slice(0, 12).map(item => {
    if (!item || typeof item !== "object") return "";
    const x = item as Record<string, unknown>;
    return typeof x.name === "string" && typeof x.description === "string"
      ? x.name.slice(0, 60) + ": " + x.description.slice(0, 150) : "";
  }).filter(Boolean);
  const rules = principles.slice(0, 12).filter((x): x is string => typeof x === "string")
    .map(x => x.slice(0, 200));
  const modes = contexts && typeof contexts === "object" && !Array.isArray(contexts)
    ? Object.entries(contexts).slice(0, 8).filter(([, v]) => typeof v === "string")
      .map(([k, v]) => k + ": " + (v as string).slice(0, 150)) : [];
  return [
    entries.length ? "Постоянные черты персонажа:\n" + entries.join("; ") : "",
    rules.length ? "Принципы поведения:\n" + rules.join("; ") : "",
    modes.length ? "Контекстные особенности общения:\n" + modes.join("; ") : "",
    "Описание персонажа не подтверждает наличие сознания, реальных чувств или права на действия без согласования.",
  ].filter(Boolean).join("\n").slice(0, 5000);
}

/** Pure presentation-only emotional cue; never a factual claim or permission grant. */
export function characterEmotionCue(raw: unknown, message: string, previousMessage?: string): string {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { emotions?: unknown }).emotions)) return "";
  if (typeof message !== "string" || !message.trim()) return "";
  const patterns: readonly [string, RegExp][] = [
    ["anxiety", /(?:опасност|тревог|страшно|угроз|боюсь|паник)/iu],
    ["tenderness", /(?:устал|грустн|поддерж|плохо на душе)/iu],
    ["joy", /(?:ура|радост|побед|получилось|успех)/iu],
    ["curiosity", /(?:почему|как устроен|интересно|исследуй)/iu],
    ["playfulness", /(?:шутк|пошути|играем|розыгрыш)/iu],
  ];
  const id = patterns.find(([, pattern]) => pattern.test(message.slice(0, 1000)))?.[0] ?? "calm";
  const previous = typeof previousMessage === "string" ? patterns.find(([, pattern]) => pattern.test(previousMessage.slice(0, 1000)))?.[0] : undefined;
  const emotion = (raw as { emotions: unknown[] }).emotions.find(item =>
    !!item && typeof item === "object" && (item as { id?: unknown }).id === id) as
      { name?: unknown; ears?: unknown; tails?: unknown } | undefined;
  if (!emotion || typeof emotion.name !== "string") return "";
  const name = emotion.name.slice(0, 48);
  const ears = typeof emotion.ears === "string" ? emotion.ears.slice(0, 100) : "";
  const tails = typeof emotion.tails === "string" ? emotion.tails.slice(0, 100) : "";
  const transition = previous && previous !== id ? " Переход от предыдущего эмоционального оттенка к текущему должен быть мягким, без резкой смены манеры и без сохранения эмоционального состояния как факта." : "";
  return `Эмоциональный оттенок художественного персонажа: ${name}.${transition} Визуальные реакции (только для сцены, не выдавай за физическое действие): уши — ${ears}; хвосты — ${tails}. Сохраняй точность, уважение и деловой стиль при решении задачи.`;
}
