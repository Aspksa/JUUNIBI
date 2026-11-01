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
