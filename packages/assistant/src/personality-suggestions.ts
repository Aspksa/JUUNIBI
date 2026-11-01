import { proposeLesson, type LessonProposal } from "./personality";

/** Deterministic, opt-in suggestions from explicit user feedback; never modifies personality. */
export function suggestConversationLessons(messages: readonly { role: string; content: string }[]): LessonProposal[] {
  const proposals: LessonProposal[] = [];
  const seen = new Set<string>();
  for (const message of messages.slice(-100)) {
    if (message.role !== "user" || typeof message.content !== "string") continue;
    const text = message.content.trim().replace(/\s+/g, " ");
    if (text.length < 12 || text.length > 500) continue;
    if (!/^(?:пожалуйста[, ]+)?(?:отвечай|общайся|пиши|не повторяй|не называй|будь|запомни[,]? что|please[,]? (?:reply|respond|avoid|be))/iu.test(text)) continue;
    const normalized = text.toLocaleLowerCase("ru-RU");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    proposals.push(proposeLesson("suggestion-" + proposals.length, text, ["Прямая просьба пользователя: " + text.slice(0, 250)], 0.8));
    if (proposals.length >= 10) break;
  }
  return proposals;
}
