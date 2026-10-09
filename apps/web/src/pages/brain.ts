import { el } from "../dom";
import { api, type BrainPlan } from "../api";
import { btn, dot, pageHead } from "./kit";

const MODES: Record<string, string> = { chat: "Обычный чат", analysis: "Анализ", agent: "Агент", creative: "Творчество" };
const PLAN_STATUS: Record<string, string> = { planned: "Запланирован", running: "Выполняется", completed: "Готов", failed: "Ошибка" };
const STEP_ICON: Record<string, string> = { pending: "○", active: "◐", done: "✓", failed: "✕" };
const STEP_STATUS: Record<string, string> = { pending: "ожидает", active: "выполняется", done: "готово", failed: "ошибка" };
const LEARN_MODE: Record<string, string> = { autonomous: "автономный", manual: "ручной" };
const CATEGORIES: Record<string, string> = { "multi-step": "Многошаговые", "error-detection": "Поиск ошибок", "rule-transfer": "Перенос правил" };
const ROLES: Record<string, string> = { juunibi: "JUUNIBI", deepseek: "Модель", verifier: "Проверка" };
const EVENT_STATUS: Record<string, string> = { question: "вопрос", unverified: "не проверено", pending: "в карантине", rejected: "отклонено", verified: "проверено" };
const KNOWLEDGE_STATUS: Record<string, string> = { verified: "проверено", "needs-review": "нужна проверка" };
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v) + "%");
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

const failed = (title: string, text: string) => [el("header", { cls: "br-block-head" }, el("h2", { textContent: title })), empty(text)];
const postJson = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---------- small building blocks ----------
/** Page block with a title, an optional one-line hint and a body. Never nested inside another block. */
function block(title: string, hint: string | null, ...kids: (Node | null)[]): HTMLElement {
  return el("section", { cls: "br-block" },
    el("header", { cls: "br-block-head" }, el("h2", { textContent: title }), hint ? el("p", { cls: "muted", textContent: hint }) : null),
    ...kids);
}
function tile(label: string, value: string, sub?: string, tone?: "ok" | "warn" | "off"): HTMLElement {
  return el("div", { cls: "br-tile" },
    el("span", { cls: "br-tile-label" }, tone ? dot(tone) : null, label),
    el("strong", { cls: "br-tile-value", textContent: value }),
    sub ? el("span", { cls: "br-tile-sub muted", textContent: sub }) : null);
}
const tag = (text: string, tone = "") => el("span", { cls: "br-tag " + tone, textContent: text });
const note = (text: string) => el("p", { cls: "br-note muted", textContent: text });
const empty = (text: string) => el("p", { cls: "br-empty muted", textContent: text });
function progress(done: number, total: number, label: string): HTMLElement {
  const v = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
  const bar = el("div", { cls: "br-bar", attrs: { role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(v) } },
    el("i", {}));
  (bar.firstElementChild as HTMLElement).style.width = v + "%";
  return bar;
}
function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el("label", { cls: "br-field" }, el("span", { textContent: label }), control, hint ? el("small", { cls: "muted", textContent: hint }) : null);
}
function fold(summary: string, ...kids: Node[]): HTMLElement {
  return el("details", { cls: "br-fold" }, el("summary", { textContent: summary }), ...kids);
}

// ---------- page ----------
/** Read-only dashboard: tasks are managed in the assistant chat, not through redundant buttons. */
export function brainPage(): HTMLElement {
  const root = el("div", { cls: "page brain" },
    pageHead("brain", "Мозг JUUNIBI", "Состояние помощницы, её планы и обучение."),
    el("div", { cls: "br-safety", attrs: { role: "note" } },
      el("div", {}, el("strong", { textContent: "Выполняется само" }), el("span", { cls: "muted", textContent: "Только чтение: список модулей и поиск по памяти." })),
      el("div", {}, el("strong", { textContent: "Только с вашего подтверждения" }), el("span", { cls: "muted", textContent: "Создание планов и любые действия с последствиями." }))));
  const content = el("div", { cls: "br-content", attrs: { "aria-live": "polite" } }, empty("Загрузка состояния…"));
  root.append(content);
  void api.brainStatus().then(r => {
    if (!r.ok) { content.replaceChildren(empty("Не удалось загрузить мозг: " + r.error.message)); return; }
    const s = r.value;
    const overview = el("div", { cls: "br-tiles" },
      tile("Помощница", s.assistantReady ? "Подключена" : "Не настроена", s.assistantReady ? undefined : "Добавьте ключ в настройках", s.assistantReady ? "ok" : "off"),
      tile("Режим", MODES[s.mode] ?? s.mode),
      tile("Планы", String(s.plans.length), s.plans.length ? "в работе: " + s.plans.filter(p => p.status === "running").length : "пока нет"));
    content.replaceChildren(overview, plansBlock(s.plans), learningPanel(), knowledgePanel(), evidenceGraphPanel(), knowledgeGapsPanel());
  });
  return root;
}

function plansBlock(plans: BrainPlan[]): HTMLElement {
  const cards = plans.map(p => {
    const done = p.steps.filter(x => x.status === "done").length;
    return el("article", { cls: "br-plan" },
      el("header", {}, el("strong", { textContent: p.goal }), tag(PLAN_STATUS[p.status] ?? p.status, p.status === "failed" ? "bad" : p.status === "completed" ? "ok" : "")),
      progress(done, p.steps.length, "Выполнено шагов"),
      el("p", { cls: "br-tile-sub muted", textContent: `Шагов выполнено: ${done} из ${p.steps.length}` }),
      el("ol", { cls: "br-steps" }, ...p.steps.map(step => el("li", { cls: "st-" + step.status },
        el("span", { cls: "br-step-ic", textContent: STEP_ICON[step.status] ?? "○", attrs: { "aria-hidden": "true" } }),
        el("span", { textContent: step.title }),
        el("span", { cls: "muted br-step-st", textContent: STEP_STATUS[step.status] ?? step.status })))));
  });
  return block("Планы", "Планы создаются в чате. Здесь видно, как они выполняются.",
    ...(cards.length ? cards : [empty("Пока нет планов. Попросите JUUNIBI составить план прямо в чате.")]));
}

/** Learning status and technical conversation, safely rendered as text nodes. */
export function learningPanel(): HTMLElement {
  const box = block("Автономное обучение", null, empty("Загрузка…"));
  async function render() {
    try {
      const response = await fetch("/api/learning");
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json() as {
        settings: { enabled: boolean; dailyLimit: number; mode: string; memory: boolean; reasoning: boolean; suggestCode: boolean };
        used: number; tokens: number; reasoningMetrics: { category: string; attempts: number; correct: number; accuracy: number | null }[]; progress: { total: number; correct: number; accuracy: number | null; recentAccuracy: number | null; difficulty: number }; diary: { questions: number; verified: number; rejected: number; pending: number; nextTopic: string; retention: string; note: string }; events: { role: string; text: string; status: string; at: string }[];
      };
      const flash = el("p", { cls: "flash", attrs: { role: "status" } });
      const save = async (patch: Record<string, unknown>) => {
        const r = await postJson("/api/learning/settings", { ...data.settings, ...patch });
        if (!r.ok) { flash.className = "flash bad"; flash.textContent = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось сохранить"; return false; }
        return true;
      };
      const toggle = btn(data.settings.enabled ? "Приостановить" : "Включить", async () => { if (await save({ enabled: !data.settings.enabled })) void render(); }, { primary: !data.settings.enabled });
      const limit = el("input", { type: "number", attrs: { min: "0", max: "50", step: "1" } });
      limit.value = String(data.settings.dailyLimit);
      const saveLimit = btn("Сохранить", async () => {
        const n = Number(limit.value);
        if (!Number.isInteger(n) || n < 0 || n > 50) { limit.setCustomValidity("От 0 до 50"); limit.reportValidity(); return; }
        limit.setCustomValidity("");
        if (await save({ dailyLimit: n })) void render();
      }, { small: true });
      const ask = btn("Задать вопрос сейчас", async () => {
        ask.disabled = true;
        try { await fetch("/api/learning/step", { method: "POST" }); } finally { void render(); }
      }, { small: true });

      const metrics = data.reasoningMetrics.length
        ? el("div", { cls: "chips" }, ...data.reasoningMetrics.map(m => el("span", { cls: "br-chip" }, CATEGORIES[m.category] ?? m.category, el("b", { textContent: `${m.correct}/${m.attempts}` }))))
        : null;
      const events = data.events.slice(-25).reverse();
      const row = (e: typeof events[number]) => el("li", { cls: "br-event" },
        el("div", { cls: "br-event-top" }, el("strong", { textContent: ROLES[e.role] ?? e.role }), tag(EVENT_STATUS[e.status] ?? e.status, e.status === "rejected" ? "bad" : e.status === "verified" ? "ok" : ""),
          el("time", { cls: "muted", textContent: when(e.at) })),
        el("p", { textContent: e.text }));
      box.replaceChildren(
        el("header", { cls: "br-block-head row" }, el("div", {}, el("h2", { textContent: "Автономное обучение" }),
          el("p", { cls: "muted", textContent: "Помощница сама задаёт вопросы модели и проверяет ответы. Код она не меняет." })),
          el("div", { cls: "br-state" }, dot(data.settings.enabled ? "ok" : "off"), el("span", { textContent: data.settings.enabled ? "Включено" : "Приостановлено" }), toggle)),
        el("div", { cls: "br-tiles" },
          tile("Запросы сегодня", `${data.used} из ${data.settings.dailyLimit}`, `режим: ${LEARN_MODE[data.settings.mode] ?? data.settings.mode}`),
          tile("Токены", String(data.tokens), "за сегодня"),
          tile("Контрольные задачи", `${data.progress.correct} из ${data.progress.total}`, "решено верно"),
          tile("Точность", pct(data.progress.accuracy), data.progress.total ? `недавно: ${pct(data.progress.recentAccuracy)}` : "пока нет данных"),
          tile("Сложность", `${data.progress.difficulty} из 5`, "растёт с успехами")),
        progress(data.used, data.settings.dailyLimit, "Использовано запросов за сутки"),
        ...(metrics ? [el("div", { cls: "br-sub" }, el("h3", { textContent: "Логические задачи" }), metrics)] : []),
        el("div", { cls: "br-sub" }, el("h3", { textContent: "Дневник развития" }),
          el("p", { textContent: `Вопросов: ${data.diary.questions} · проверено: ${data.diary.verified} · отклонено: ${data.diary.rejected} · в карантине: ${data.diary.pending}` }),
          el("p", { textContent: "Следующая тема: " + data.diary.nextTopic }),
          note(data.diary.note)),
        el("div", { cls: "br-sub" }, el("h3", { textContent: "Настройки" }),
          el("div", { cls: "br-row" }, field("Запросов в сутки (0–50)", limit), saveLimit, ask), flash),
        el("div", { cls: "br-sub" }, el("h3", { textContent: "Журнал" }),
          events.length ? el("ul", { cls: "br-events" }, ...events.slice(0, 5).map(row)) : empty("Журнал пуст."),
          events.length > 5 ? fold(`Показать ещё ${events.length - 5}`, el("ul", { cls: "br-events" }, ...events.slice(5).map(row))) : null));
    } catch { box.replaceChildren(...failed("Автономное обучение", "Нет соединения с журналом обучения.")); }
  }
  void render();
  return box;
}

/** Owner-reviewed knowledge and spaced-repetition dashboard. No AI output is auto-approved. */
export function knowledgePanel(): HTMLElement {
  const root = block("Реестр проверенных знаний", null, empty("Загрузка…"));
  const load = async () => {
    try {
      const r = await fetch("/api/knowledge");
      if (!r.ok) throw new Error(String(r.status));
      const rows = await r.json() as { id: string; topic: string; claim: string; source: string; status: string; nextReviewAt: string }[];
      const entries = rows.slice(-50).reverse().map(item => {
        const report = async (correct: boolean) => {
          await postJson("/api/knowledge/review", { id: item.id, correct }); void load();
        };
        return el("article", { cls: "br-know" },
          el("header", {}, el("strong", { textContent: item.topic }), tag(KNOWLEDGE_STATUS[item.status] ?? item.status, item.status === "verified" ? "ok" : "warn")),
          el("p", { textContent: item.claim }),
          el("p", { cls: "muted br-tile-sub", textContent: `Источник: ${item.source} · повторить: ${when(item.nextReviewAt)}` }),
          el("div", { cls: "br-row" }, btn("Повторил — верно", () => void report(true), { small: true }), btn("Нужна проверка", () => void report(false), { small: true })));
      });
      root.replaceChildren(
        el("header", { cls: "br-block-head" }, el("h2", { textContent: "Реестр проверенных знаний" }),
          el("p", { cls: "muted", textContent: "Факты, которые проверил тест или подтвердили вы. Это отдельный реестр: он не связан с разделом «Память», где хранится то, что помощница помнит о вас. Ответы модели сами фактами не становятся." })),
        ...(entries.length ? entries : [empty("Подтверждённых знаний пока нет.")]));
    } catch { root.replaceChildren(...failed("Реестр проверенных знаний", "Реестр знаний недоступен.")); }
  };
  void load();
  return root;
}

/** Owner-facing source check. Quotes are only evidence candidates, never automatically trusted facts. */
export function evidenceGraphPanel(): HTMLElement {
  const root = block("Источники и связи", null, empty("Загрузка графа…"));
  const source = el("select", {},
    ...[["nasa", "NASA"], ["britannica", "Britannica"], ["python", "Python Docs"], ["mdn", "MDN"]]
      .map(([value, label]) => el("option", { value, textContent: label })));
  const sectionField = el("input", { type: "text", placeholder: "например, library/", maxLength: 160 });
  const quote = el("textarea", { placeholder: "Точная цитата с сайта, не короче 30 символов", rows: 3 });
  const result = el("p", { cls: "flash", attrs: { "aria-live": "polite" } });
  const check = btn("Найти цитату", async () => {
    check.disabled = true;
    result.className = "flash"; result.textContent = "Проверка…";
    try {
      const r = await postJson("/api/knowledge/evidence", { source: source.value, section: sectionField.value, quote: quote.value });
      const response = await r.json() as { matched?: boolean; source?: string; error?: string };
      if (r.ok) {
        result.className = response.matched ? "flash" : "flash bad";
        result.textContent = (response.matched ? "Цитата найдена. Это ещё не доказательство истинности факта. " : "Цитата не найдена. ") + (response.source ?? "");
      } else { result.className = "flash bad"; result.textContent = "Ошибка проверки: " + (response.error ?? r.status); }
    } catch { result.className = "flash bad"; result.textContent = "Источник недоступен."; }
    finally { check.disabled = false; }
  }, { primary: true });
  void fetch("/api/knowledge/graph").then(async r => {
    if (!r.ok) throw new Error(String(r.status));
    const graph = await r.json() as { nodes: { id: string; topic: string }[];
      edges: { from: string; to: string; shared: string[] }[] };
    const names = new Map(graph.nodes.map(n => [n.id, n.topic]));
    const edges = graph.edges.slice(0, 30).map(e => el("li", {},
      el("strong", { textContent: `${names.get(e.from) ?? "?"} ↔ ${names.get(e.to) ?? "?"}` }),
      el("span", { cls: "muted", textContent: e.shared.join(", ") })));
    root.replaceChildren(
      el("header", { cls: "br-block-head" }, el("h2", { textContent: "Источники и связи" }),
        el("p", { cls: "muted", textContent: "Связи между знаниями и поиск точной цитаты в справочниках." })),
      el("div", { cls: "br-tiles" }, tile("Знаний в графе", String(graph.nodes.length)), tile("Связей", String(graph.edges.length))),
      ...(edges.length ? [fold(`Показать связи (${edges.length})`, el("ul", { cls: "br-links" }, ...edges))] : []),
      el("div", { cls: "br-sub" }, el("h3", { textContent: "Поиск цитаты в справочнике" }),
        note("Найденная цитата не даёт права записывать факт в память автоматически."),
        el("div", { cls: "br-form" },
          field("Справочник", source), field("Раздел сайта", sectionField), field("Цитата", quote),
          el("div", { cls: "br-row" }, check)), result));
  }).catch(() => root.replaceChildren(...failed("Источники и связи", "Граф знаний недоступен.")));
  return root;
}

/** Read-only learning opportunities; no automatic tool execution. */
export function knowledgeGapsPanel(): HTMLElement {
  const root = block("Пробелы в знаниях", null, empty("Анализ…"));
  void fetch("/api/knowledge/gaps").then(async r => {
    if (!r.ok) throw new Error(String(r.status));
    const gaps = await r.json() as { topic: string; reason: string; priority: number }[];
    root.replaceChildren(
      el("header", { cls: "br-block-head" }, el("h2", { textContent: "Пробелы в знаниях" }),
        el("p", { cls: "muted", textContent: "Что стоит изучить или перепроверить." })),
      gaps.length ? el("ul", { cls: "br-links" }, ...gaps.slice(0, 15).map(g => el("li", {},
        el("strong", { textContent: g.topic }), tag(g.priority > 1 ? "перепроверить" : "изучить", g.priority > 1 ? "warn" : ""), el("span", { cls: "muted", textContent: g.reason }))))
        : empty("Пробелов не найдено или реестр пока пуст."));
  }).catch(() => root.replaceChildren(...failed("Пробелы в знаниях", "Не удалось прочитать пробелы знаний.")));
  return root;
}
