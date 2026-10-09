/** Conservative, read-only task triage: does not authorize tools or invent a plan. */
export function classifyChatTask(message: unknown) {
 if(typeof message!=="string" || message.length>100000)
  throw Object.assign(new Error("Некорректное сообщение"),{status:400});
 const text=message.trim();
 const risky=/(удали|удалить|сотри|перезапиши|оплати|купи|отправь|публикуй|запусти|установи|обнови|сливай|merge|delete|publish|install|deploy|pay|purchase)/i.test(text);
 const complex=/(разработ|спланируй|исследуй|проверь|аудит|проект|этап|сначала|затем|несколько|сравни|создай|implement|research|plan|analy[sz]e|multi.step)/i.test(text);
 const needsPlanning=complex || risky;
 return {needsPlanning,needsApproval:risky,needsEvidenceReview:/(провер|исслед|факт|источник|доказ|аудит|verify|fact|source|research)/i.test(text),
  suggestedStages:needsPlanning?["clarify-goal","prepare-plan","verify-constraints","ask-approval"]:["respond"],
  note:"Эвристика по формулировке запроса. Не подтверждает разрешения и не запускает инструменты."};
}
