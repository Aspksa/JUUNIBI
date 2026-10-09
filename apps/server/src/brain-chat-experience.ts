/** Conservative hints from observed outcomes, never authorizations or proof of learning. */
export function summarizeChatExperience(report: {
  decisionGroups: { name: string; confirmed: number; successRate: number | null }[];
  warnings: string[];
}) {
  const groups = report.decisionGroups
    .filter(x => typeof x.name === "string" && Number.isInteger(x.confirmed) && x.confirmed >= 5 &&
      x.successRate !== null && Number.isFinite(x.successRate) && x.successRate >= 0 && x.successRate <= 100)
    .sort((a, b) => a.successRate! - b.successRate! || b.confirmed - a.confirmed)
    .slice(0, 3)
    .map(x => ({ taskType: x.name.slice(0, 60), samples: x.confirmed, observedSuccessRate: x.successRate }));
  return {
    weakAreas: groups.filter(x => x.observedSuccessRate! < 60),
    evidenceLimited: groups.length === 0,
    advice: "Исторические результаты — слабая подсказка, не доказательство правильности. При недостатке данных проверяй предположения и проси источники. Не меняй разрешения и не заявляй, что обучение весов модели произошло.",
  };
}
