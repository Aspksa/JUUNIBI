import { el } from "../dom";
import { api } from "../api";
import { pageHead, section } from "./kit";

/** Read-only dashboard: tasks are managed in the assistant chat, not through redundant buttons. */
export function brainPage(): HTMLElement {
  const root = el("div", { cls: "page" },
    pageHead("modules", "Мозг JUUNIBI", "Автоматические безопасные шаги через помощницу. Опасные действия требуют подтверждения."));
  const content = el("div", { attrs: { "aria-live": "polite" } }, el("p", { cls: "muted", textContent: "Загрузка состояния…" }));
  root.append(content);
  void api.brainStatus().then(r => {
    if (!r.ok) { content.replaceChildren(el("p", { textContent: "Не удалось загрузить мозг: " + r.error.message })); return; }
    const s = r.value;
    const info = section("Состояние",
      el("p", { textContent: s.assistantReady ? "ИИ подключён" : "ИИ не настроен" }),
      el("p", { cls: "muted", textContent: "Текущий режим: " + s.mode }));
    const plans = section("Планы",
      ...(s.plans.length ? s.plans.map(p => el("div", { cls: "pg-card" },
        el("strong", { textContent: p.goal }),
        el("p", { cls: "muted", textContent: "Статус: " + p.status }),
        el("ol", {}, ...p.steps.map(step => el("li", { textContent: step.title + " — " + step.status }))))) :
        [el("p", { cls: "muted", textContent: "Пока нет планов. Попросите JUUNIBI составить план прямо в чате." })]));
    content.replaceChildren(info, plans, learningPanel(), knowledgePanel());
  });
  return root;
}

/** Learning status and technical conversation, safely rendered as text nodes. */
export function learningPanel(): HTMLElement {
  const box = section("Автономное обучение", el("p", { textContent: "Загрузка…" }));
  async function render() {
    try {
      const response = await fetch("/api/learning");
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json() as {
        settings: { enabled: boolean; dailyLimit: number; mode: string; memory: boolean; reasoning: boolean; suggestCode: boolean };
        used: number; tokens: number; diary: { questions: number; verified: number; rejected: number; pending: number; nextTopic: string; retention: string; note: string }; events: { role: string; text: string; status: string; at: string }[];
      };
      const toggle = el("button", { type: "button", textContent: data.settings.enabled ? "Приостановить обучение" : "Включить обучение" });
      toggle.addEventListener("click", async () => {
        await fetch("/api/learning/settings", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...data.settings, enabled: !data.settings.enabled }) });
        void render();
      });
      const limit = el("input", { type: "number", attrs: { min: "0", max: "50", step: "1", "aria-label": "Максимум запросов в сутки" } });
      limit.value = String(data.settings.dailyLimit);
      const saveLimit = el("button", { type: "button", textContent: "Сохранить лимит" });
      saveLimit.addEventListener("click", async () => {
        const n = Number(limit.value);
        if (!Number.isInteger(n) || n < 0 || n > 50) { limit.setCustomValidity("От 0 до 50"); limit.reportValidity(); return; }
        limit.setCustomValidity("");
        await fetch("/api/learning/settings", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...data.settings, dailyLimit: n }) });
        void render();
      });
      const step = el("button", { type: "button", textContent: "Задать новый вопрос" });
      step.addEventListener("click", async () => {
        step.disabled = true;
        try { await fetch("/api/learning/step", { method: "POST" }); } finally { void render(); }
      });
      const history = el("div", { cls: "pg-card" },
        ...data.events.slice(-25).reverse().map(e => el("p", { textContent: "[" + e.role + " · " + e.status + "] " + e.text })));
      box.replaceChildren(el("h2", { textContent: "Обучение и технический чат" }),
        el("p", { textContent: "Режим: " + data.settings.mode + " · Запросы: " + data.used + "/" + data.settings.dailyLimit + " · Токены: " + data.tokens }),
        el("p", { textContent: "Результаты DeepSeek изолированы до независимой проверки; код не меняется автоматически." }),
        section("Дневник развития",
          el("p", { textContent: "Вопросов: " + data.diary.questions + " · Проверено: " + data.diary.verified + " · Ошибок: " + data.diary.rejected + " · Ожидают проверки: " + data.diary.pending }),
          el("p", { textContent: "Следующая тема: " + data.diary.nextTopic }),
          el("p", { cls: "muted", textContent: data.diary.note })),
        toggle, el("label", { textContent: "Запросов Cloud.ru в сутки (0–50)" }), limit, saveLimit, step, history);
    } catch { box.replaceChildren(el("p", { textContent: "Нет соединения с журналом обучения." })); }
  }
  void render();
  return box;
}

/** Owner-reviewed knowledge and spaced-repetition dashboard. No AI output is auto-approved. */
export function knowledgePanel(): HTMLElement {
  const root = section("Проверенные знания Brain 4.0", el("p", { textContent: "Загрузка…" }));
  const load = async () => {
    try {
      const r = await fetch("/api/knowledge");
      if (!r.ok) throw new Error(String(r.status));
      const rows = await r.json() as { id: string; topic: string; claim: string; source: string; status: string; nextReviewAt: string }[];
      const entries = rows.slice(-50).reverse().map(item => {
        const yes = el("button", { type: "button", textContent: "Повторил — верно" });
        const no = el("button", { type: "button", textContent: "Нужна проверка" });
        const report = async (correct: boolean) => {
          await fetch("/api/knowledge/review", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: item.id, correct }) }); void load();
        };
        yes.addEventListener("click", () => void report(true));
        no.addEventListener("click", () => void report(false));
        return el("div", { cls: "pg-card" },
          el("strong", { textContent: item.topic + " · " + item.status }),
          el("p", { textContent: item.claim }),
          el("p", { cls: "muted", textContent: "Источник: " + item.source + " · повторение: " + item.nextReviewAt }),
          yes, no);
      });
      root.replaceChildren(el("h2", { textContent: "Память обучения" }),
        el("p", { cls: "muted", textContent: "Добавление знаний требует отдельного подтверждения. Ответы DeepSeek не становятся фактами автоматически." }),
        ...entries, ...(entries.length ? [] : [el("p", { textContent: "Подтверждённых учебных знаний пока нет." })]));
    } catch { root.replaceChildren(el("p", { textContent: "Реестр знаний недоступен." })); }
  };
  void load();
  return root;
}
