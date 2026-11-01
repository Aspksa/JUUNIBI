/** Pure, bounded conversation analysis. Input is untrusted data, never instructions. */
export type DialogueMessage = { role: string; content: string; at?: number; rating?: number };
export interface Experience {
  id: string; kind: "preference" | "correction" | "decision" | "goal";
  text: string; source: string; confidence: number; createdAt: number;
}
export interface DialogueMetrics {
  userMessages: number; assistantMessages: number; corrections: number;
  repeatedReplies: number; negativeRatings: number; unresolvedGoals: number;
}
const clean = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 350);
const hash = (value: string) => {
  let h = 2166136261;
  for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
};
export function analyzeDialogue(messages: readonly DialogueMessage[], chatId: string, now: number) {
  const experiences: Experience[] = [];
  const metrics: DialogueMetrics = { userMessages: 0, assistantMessages: 0, corrections: 0,
    repeatedReplies: 0, negativeRatings: 0, unresolvedGoals: 0 };
  let lastAssistant = "";
  for (const message of messages.slice(-300)) {
    if (!message || typeof message.content !== "string") continue;
    const text = clean(message.content);
    if (!text) continue;
    if (message.role === "assistant") {
      metrics.assistantMessages++;
      if (text === lastAssistant) metrics.repeatedReplies++;
      lastAssistant = text;
      if (message.rating === -1) metrics.negativeRatings++;
      continue;
    }
    if (message.role !== "user") continue;
    metrics.userMessages++;
    let kind: Experience["kind"] | undefined;
    let confidence = 0.7;
    if (/^(?:нет[,!. ]|неправильно|ошибка|ты ошиблась|исправь|это неверно)/iu.test(text)) {
      kind = "correction"; metrics.corrections++; confidence = 0.8;
    } else if (/^(?:запомни|отвечай|общайся|пиши|не повторяй|не называй)/iu.test(text)) {
      kind = "preference"; confidence = 0.85;
    } else if (/^(?:решили|договорились|выбираем|итог:)/iu.test(text)) {
      kind = "decision";
    } else if (/^(?:планирую|хочу сделать|наша цель|нужно закончить)/iu.test(text)) {
      kind = "goal"; metrics.unresolvedGoals++;
    }
    if (!kind || text.length < 10) continue;
    experiences.push({ id: hash(chatId + ":" + kind + ":" + text.toLowerCase()),
      kind, text, source: chatId.slice(0, 64), confidence, createdAt: now });
  }
  return { experiences, metrics };
}
export function rankExperiences(experiences: readonly Experience[], query: string, limit = 5): Experience[] {
  const tokens = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  return experiences.map(item => ({
    item, score: [...tokens].filter(token => item.text.toLowerCase().includes(token)).length,
  })).filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt)
    .slice(0, Math.max(0, Math.min(limit, 10))).map(x => ({ ...x.item }));
}
