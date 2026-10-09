import type { UnifiedCycleInput } from "./brain-v4-cycle";

/** Deterministic, bounded diagnostics; absence of evidence is never interpreted as success. */
export function evaluateBrainV5(input: UnifiedCycleInput) {
  if (!input || typeof input.message !== "string" || input.message.length > 100000)
    throw new Error("Некорректный запрос");
  const message = input.message.slice(0, 4000);
  const normalized = message.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е");
  const words = normalized.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const terms = new Set(words);
  const verified = (input.verifiedKnowledge ?? []).filter(x => x.status === "verified").slice(0, 500);
  const relevant = verified.map(x => {
    const w = new Set(((x.topic + " " + x.claim).normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").match(/[\p{L}\p{N}]{3,}/gu) ?? []));
    return { record: x, overlap: [...terms].filter(t => w.has(t)).length };
  }).filter(x => x.overlap > 0).sort((a,b) => b.overlap-a.overlap).slice(0,8);
  const warnings = (input.recentToolWarnings ?? []).slice(0,50);
  const decisions = (input.decisionGroups ?? []).filter(x => x.confirmed >= 5 && x.successRate !== null && Number.isFinite(x.successRate) && x.successRate >= 0 && x.successRate <= 100).slice(0,50);
  const risk = /удал|оплат|публику|запуст|установ|отправ|слива|delete|deploy|pay|merge/i.test(normalized);
  const question = /[?？]/u.test(message);
  const enumerated = /(?:^|\n)\s*(?:\d+[.)]|[-*])\s/m.test(message);
  const goals = message.split(/[.!?\n]+/).filter(x => /(?:нужно|хочу|сделай|создай|проверь|исправь|разработ)/i.test(x)).length;
  const hasEvidence = relevant.length > 0;
  const weak = decisions.filter(x => x.successRate! < 60);
  const count = (re: RegExp) => (normalized.match(re) ?? []).length;
  type Signal = { id: string; value: number | boolean | null; state: "measured" | "unknown"; explanation: string };
  const measured = (id: string, value: number | boolean, explanation: string): Signal => ({id,value,state:"measured",explanation});
  const unknown = (id: string, explanation: string): Signal => ({id,value:null,state:"unknown",explanation});
  const signals: Signal[] = [
    measured("goal_clauses",goals,"Количество явно сформулированных целей"),
    measured("unique_terms",terms.size,"Разнообразие слов в запросе"),
    measured("question_present",question,"Наличие вопросительной конструкции"),
    measured("task_structure",enumerated,"Наличие структурированного списка"),
    measured("verified_matches",relevant.length,"Совпадения по подтверждённым знаниям"),
    measured("knowledge_coverage",verified.length,"Объём доступного реестра проверенных записей"),
    measured("lexical_relevance",relevant[0]?.overlap ?? 0,"Наибольшее точное пересечение слов"),
    measured("knowledge_duplicates",new Set(verified.map(x=>x.claim.toLowerCase().trim())).size !== verified.length,"Есть ли текстовые дубли знаний"),
    measured("unverified_records",(input.verifiedKnowledge ?? []).filter(x=>x.status!=="verified").length,"Неодобренные или требующие проверки записи"),
    measured("knowledge_context_size",relevant.reduce((n,x)=>n+x.record.claim.length,0),"Символьный бюджет извлечённых знаний"),
    measured("contradiction_cues",count(/\b(?:но|однако|противореч|неверн)\b/gu),"Слова-маркеры противоречий, не доказательство конфликта"),
    measured("causal_cues",count(/\b(?:потому|поэтому|из-за|следовательно)\b/gu),"Явные причинные маркеры"),
    measured("conditional_cues",count(/\b(?:если|иначе|при условии)\b/gu),"Условные конструкции"),
    measured("alternative_cues",count(/\b(?:или|вариант|альтернатив)\b/gu),"Упоминания альтернатив"),
    measured("sequence_cues",count(/\b(?:сначала|затем|после|перед)\b/gu),"Маркеры последовательности"),
    measured("constraint_cues",count(/\b(?:лимит|срок|бюджет|нельзя|огранич)\b/gu),"Маркеры ограничений"),
    measured("risk_intent",risk,"Потенциально значимые действия"),
    measured("explicit_approval_request",/подтверд|разреш|одобр/i.test(normalized),"Пользователь упоминает подтверждение; это не разрешение"),
    measured("tool_cautions",warnings.filter(x=>x.caution).length,"Предупреждения по инструментам"),
    measured("tool_denials",warnings.reduce((n,x)=>n+x.denied,0),"Исторические отказы в доступе"),
    measured("confirmed_categories",decisions.length,"Категории с достаточным числом подтверждённых исходов"),
    measured("weak_categories",weak.length,"Категории с долей успеха ниже 60%"),
    measured("confirmed_samples",decisions.reduce((n,x)=>n+x.confirmed,0),"Количество подтверждённых исходов в допустимых категориях"),
    decisions.length ? measured("lowest_observed_success",Math.min(...decisions.map(x=>x.successRate!)),"Минимальная наблюдаемая доля успеха") : unknown("lowest_observed_success","Нет достаточной статистики"),
    measured("learning_enabled",input.learningEnabled===true,"Включена ли настройка учебного движка"),
    measured("repetition_cues",count(/\b(?:повтори|вспомни|запомни)\b/gu),"Явные запросы на повторение"),
    measured("transfer_cues",count(/\b(?:похож|другой|новый пример)\b/gu),"Маркеры применения навыка в новом контексте"),
    unknown("answer_correctness","Без ответа и эталона корректность не измеряется"),
    unknown("learning_improvement","Нужны независимые замеры до и после обучения"),
    measured("review_gaps",Number(!hasEvidence)+Number(decisions.length===0)+Number(warnings.length>0),"Пробелы данных и эксплуатационные предупреждения"),
  ];
  return { version:"5.0",signalCount:signals.length,signals,
    recommendations:[
      ...(!hasEvidence?["Не выдавай неподтверждённые факты за проверенные."]:[]),
      ...(risk?["Любое действие с последствиями должно пройти ApprovalGate."]:[]),
      ...(weak.length?["Учитывай низкие результаты подтверждённых решений, но не делай причинных выводов без проверки."]:[]),
      ...(warnings.length?["Проверь предусловия инструментов; не обходи отказы."]:[]),
    ], matchedKnowledge: relevant.map(x=>({topic:x.record.topic,claim:x.record.claim,overlap:x.overlap})),
    advisoryOnly:true as const, actionsExecuted:false as const, weightsUpdated:false as const };
}
