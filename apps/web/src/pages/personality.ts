import { el } from "../dom";
import type { Chats } from "../chat/chats";

type Trait = "warmth" | "curiosity" | "brevity" | "initiative";
type Snapshot = { version: number; traits: Record<Trait, number>; acceptedLessons: string[] };
const labels: Record<Trait, string> = {
  warmth: "Теплота", curiosity: "Любознательность", brevity: "Краткость", initiative: "Инициативность",
};
const traits = Object.keys(labels) as Trait[];

async function apiRequest<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, body ? {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, approved: true }),
  } : undefined);
  const data: unknown = await response.json();
  if (!response.ok) throw new Error((data as { error?: string }).error ?? "Ошибка сервера");
  return data as T;
}

export function personalityPanel(chats?: Chats): HTMLElement {
  const status = el("p", { cls: "muted", textContent: "Загрузка профиля…" });
  const controls = el("div");
  const versions = el("div");
  const lessonForm = el("form");
  const suggestions = el("div");
  const background = el("div");
  const panel = el("section", { cls: "pg-card set-card", id: "personality-panel" },
    el("header", { cls: "set-card-head" },
      el("div", {}, el("h2", { textContent: "Личность JUUNIBI" }),
        el("p", { cls: "muted", textContent: "Характер, уроки общения и история изменений. Все изменения подтверждаются." }))),
    el("div", { cls: "set-card-body" }, status, background, controls, versions, lessonForm, suggestions));
  let busy = false;
  async function change(url: string, body: object) {
    if (busy) return;
    busy = true;
    try { await apiRequest<Snapshot>(url, body); await load(); }
    catch (error) { status.textContent = (error as Error).message; }
    finally { busy = false; }
  }
  async function load() {
    try {
      const [current, history] = await Promise.all([
        apiRequest<Snapshot>("/api/personality"),
        apiRequest<Snapshot[]>("/api/personality/history"),
      ]);
      status.textContent = "Текущая версия: " + current.version + " · подтверждённых уроков: " + current.acceptedLessons.length;
      controls.replaceChildren(el("h3", { textContent: "Характер" }), ...traits.map(trait => {
        const value = current.traits[trait];
        const valueText = el("span", { textContent: Math.round(value * 100) + "%" });
        const slider = el("input", { type: "range", min: "0", max: "100", step: "10", value: String(Math.round(value * 100)),
          attrs: { "aria-label": labels[trait] } });
        slider.addEventListener("input", () => { valueText.textContent = slider.value + "%"; });
        slider.addEventListener("change", () => {
          const requested = Number(slider.value) / 100 - value;
          const delta = Math.round(Math.max(-0.1, Math.min(0.1, requested)) * 100) / 100;
          if (!delta) { slider.value = String(Math.round(value * 100)); return; }
          if (!confirm("Изменить «" + labels[trait] + "» на " + Math.round((value + delta) * 100) + "%?")) {
            slider.value = String(Math.round(value * 100)); valueText.textContent = Math.round(value * 100) + "%"; return;
          }
          void change("/api/personality/trait", { trait, delta });
        });
        return el("label", { cls: "set-row" }, el("strong", { textContent: labels[trait] }), slider, valueText);
      }));
      versions.replaceChildren(el("h3", { textContent: "История развития" }),
        ...history.slice().reverse().map(snapshot => {
          const restore = el("button", { type: "button", textContent: "Восстановить", disabled: snapshot.version === current.version });
          restore.addEventListener("click", () => {
            if (confirm("Восстановить версию " + snapshot.version + "? Это создаст новую версию.")) {
              void change("/api/personality/restore", { version: snapshot.version });
            }
          });
          return el("div", { cls: "set-row" },
            el("span", { textContent: "Версия " + snapshot.version + " · уроков: " + snapshot.acceptedLessons.length }), restore);
        }));
    } catch (error) { status.textContent = "Профиль недоступен: " + (error as Error).message; }
  }

  const lesson = el("textarea", { rows: 2, maxLength: 500, placeholder: "Чему JUUNIBI стоит научиться?" });
  const evidence = el("textarea", { rows: 2, maxLength: 300, placeholder: "Пример или причина (обязательно)" });
  const confidence = el("input", { type: "number", min: "0.6", max: "1", step: "0.05", value: "0.9", attrs: { "aria-label": "Уверенность" } });
  const submit = el("button", { type: "submit", textContent: "Подтвердить урок" });
  lessonForm.replaceChildren(el("h3", { textContent: "Новый урок" }),
    el("p", { cls: "muted", textContent: "Урок сохраняется только после вашего подтверждения. Он не переобучает модель." }),
    lesson, evidence, el("label", {}, "Уверенность ", confidence), submit);
  lessonForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!lesson.value.trim() || !evidence.value.trim()) { status.textContent = "Заполните урок и пример"; return; }
    if (!confirm("Сохранить этот урок в историю личности?")) return;
    const id = "lesson-" + crypto.randomUUID();
    void change("/api/personality/lesson", {
      id, lesson: lesson.value.trim(), evidence: [evidence.value.trim()], confidence: Number(confidence.value),
    });
  });
  const scan = el("button", { type: "button", textContent: "Анализировать историю чатов" });
  scan.addEventListener("click", async () => {
    if (!chats) return;
    const messages = chats.store.get().items.flatMap(chat => chat.messages)
      .filter(message => message.role === "user").sort((a, b) => a.at - b.at)
      .slice(-100).map(message => ({ role: "user", content: message.content.slice(0, 2000) }));
    try {
      const proposals = await apiRequest<{ lesson: string; evidence: string[]; confidence: number }[]>(
        "/api/personality/suggestions", { messages });
      suggestions.replaceChildren(scan, el("p", { textContent: proposals.length ?
        "Предложения требуют вашего подтверждения." : "Явных пожеланий по стилю не найдено." }),
        ...proposals.map(proposal => {
          const approve = el("button", { type: "button", textContent: "Принять" });
          approve.addEventListener("click", () => {
            if (confirm("Принять урок: " + proposal.lesson + "?"))
              void change("/api/personality/lesson", { ...proposal, id: "lesson-" + crypto.randomUUID() });
          });
          return el("div", { cls: "set-row" }, el("span", { textContent: proposal.lesson }), approve);
        }));
    } catch (error) { status.textContent = (error as Error).message; }
  });
  suggestions.append(scan);
  type Evolution = { config: { enabled: boolean; intervalMinutes: number; night: boolean; memory: boolean; personality: boolean; quality: boolean };
    queue: { id: string; lesson: string; status: string }[]; runs: number; lastRun: number; lastError: string | null; analyzedMessages: number; running: boolean };
  async function evolutionRequest(url: string, body?: object): Promise<Evolution> {
    const response = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body) } : undefined);
    const data = await response.json() as Evolution & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Ошибка фонового развития");
    return data;
  }
  async function loadEvolution() {
    try {
      const state = await evolutionRequest("/api/ramo/evolution");
      const summary = el("p", { cls: "muted", textContent: "Циклов: " + state.runs +
        " · сообщений обработано: " + state.analyzedMessages + " · последний запуск: " +
        (state.lastRun ? new Date(state.lastRun).toLocaleString("ru-RU") : "ещё не запускался") +
        (state.lastError ? " · ошибка: " + state.lastError : "") });
      const controls = (["enabled", "night", "memory", "personality", "quality"] as const).map(key => {
        const names = { enabled: "Фоновый анализ", night: "Ночной режим", memory: "Обработка памяти",
          personality: "Предложения по характеру", quality: "Оценка качества" };
        const checkbox = el("input", { type: "checkbox", checked: state.config[key] });
        checkbox.addEventListener("change", () => {
          void evolutionRequest("/api/ramo/evolution/config", { [key]: checkbox.checked })
            .then(loadEvolution).catch(error => { status.textContent = String(error); void loadEvolution(); });
        });
        return el("label", { cls: "set-row" }, checkbox, el("span", { textContent: names[key] }));
      });
      const interval = el("select", { attrs: { "aria-label": "Интервал анализа" } },
        ...[15, 30, 60].map(minutes => el("option", { value: String(minutes),
          textContent: "Каждые " + minutes + " минут", selected: state.config.intervalMinutes === minutes })));
      interval.addEventListener("change", () => {
        void evolutionRequest("/api/ramo/evolution/config", { intervalMinutes: Number(interval.value) })
          .then(loadEvolution).catch(error => { status.textContent = String(error); });
      });
      const run = el("button", { type: "button", textContent: "Запустить анализ сейчас", disabled: state.running || !state.config.enabled });
      run.addEventListener("click", () => {
        run.disabled = true;
        void evolutionRequest("/api/ramo/evolution/run", {}).then(loadEvolution)
          .catch(error => { status.textContent = String(error); run.disabled = false; });
      });
      const pending = state.queue.filter(item => item.status === "pending");
      background.replaceChildren(el("h3", { textContent: "Фоновое развитие RAMO" }), summary, ...controls,
        el("div", { cls: "set-row" }, interval, run),
        el("h4", { textContent: "Ожидают подтверждения: " + pending.length }),
        ...pending.map(item => {
          const decision = (value: "accepted" | "rejected", label: string) => {
            const button = el("button", { type: "button", textContent: label });
            button.addEventListener("click", () => {
              if (value === "accepted" && !confirm("Подтвердить урок: " + item.lesson + "?")) return;
              void evolutionRequest("/api/ramo/evolution/decision", { id: item.id, decision: value, approved: true })
                .then(async () => { await loadEvolution(); await load(); })
                .catch(error => { status.textContent = String(error); });
            });
            return button;
          };
          return el("div", { cls: "set-row" }, el("span", { textContent: item.lesson }),
            decision("accepted", "Принять"), decision("rejected", "Отклонить"));
        }));
    } catch (error) { background.replaceChildren(el("p", { cls: "muted", textContent: "Фоновое развитие недоступно: " + String(error) })); }
  }
  void loadEvolution();
  void load();
  return panel;
}
