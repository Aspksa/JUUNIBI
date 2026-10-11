/** Render trusted tool data without letting a language model invent readings or invocation history. */
export function formatFunctionalHealthReport(raw: string): string {
  let data: any;
  try { data = JSON.parse(raw); } catch { return "Диагностика вернула некорректный JSON. Достоверный отчёт недоступен."; }
  if (!data || !Array.isArray(data.results)) return "Диагностика не вернула список проверок.";
  const safe = (v: unknown) => String(v ?? "—").replace(/[|\r\n]/g, " ").slice(0, 320);
  const rows = data.results.map((r: any) => {
    const status = ["PASS","FAIL","SKIPPED"].includes(r?.status) ? r.status : "FAIL";
    return "| " + safe(r?.module) + " | " + status + " | " + (Number.isFinite(r?.durationMs) ? r.durationMs : "—") + " | " + safe(r?.detail) + " |";
  });
  const counts = ["PASS","FAIL","SKIPPED"].map(status => status + ": " + data.results.filter((r: any) => r?.status === status).length).join(" · ");
  return "**Функциональная диагностика — результаты инструмента**\n\n" +
    "| Модуль | Статус | Время, мс | Фактическая проверка |\n|---|---|---|---|\n" +
    rows.join("\n") + "\n\n" + counts +
    "\n\nВремя формирования результата: " + safe(data.checkedAt) +
    "\n\n" + safe(data.note ?? "PASS подтверждает только указанную проверку. Если тест пропущен, он не считается выполненным.") +
    "\n\n**Важно:** выводы о прошлых вызовах, причинах переходов updater и других инструментах не создавались моделью.";
}
