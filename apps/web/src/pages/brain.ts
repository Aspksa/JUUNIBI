import { el } from "../dom";
import { api, type BrainStatus } from "../api";
import { btn, pageHead, section } from "./kit";

const LABEL: Record<BrainStatus["mode"], string> = { chat: "Общение", analysis: "Анализ", agent: "Агент", creative: "Творчество" };
export function brainPage(): HTMLElement {
  const root = el("div", { cls: "page" }, pageHead("modules", "Мозг JUUNIBI", "Режимы интеллекта, цели и планы. Реальные действия требуют отдельных разрешений."));
  const content = el("div");
  root.append(content);
  const render = async () => {
    const response = await api.brainStatus();
    if (!response.ok) { content.replaceChildren(el("p", { textContent: "Мозг недоступен: " + response.error.message })); return; }
    const state = response.value;
    const modes = el("div", { cls: "mod-summary" }, ...(["chat", "analysis", "agent", "creative"] as const).map(m =>
      btn(LABEL[m] + (state.mode === m ? " ✓" : ""), async () => { const r = await api.brainMode(m); if (r.ok) void render(); }, { primary: state.mode === m })));
    const goal = el("input", { attrs: { placeholder: "Цель задачи", "aria-label": "Цель" } }) as HTMLInputElement;
    const steps = el("textarea", { attrs: { placeholder: "Шаги — по одному на строке", "aria-label": "Шаги плана", rows: "4" } }) as HTMLTextAreaElement;
    const feedback = el("p", { cls: "muted", attrs: { role: "status" } });
    const create = btn("Создать план", async () => {
      const r = await api.brainPlan(goal.value, steps.value.split("\n").map(s => s.trim()).filter(Boolean));
      if (!r.ok) { feedback.textContent = r.error.message; return; }
      void render();
    }, { primary: true });
    const plans = state.plans.map(p => section(p.goal,
      el("p", { cls: "muted", textContent: "Статус: " + p.status }),
      el("ol", {}, ...p.steps.map(s => el("li", { textContent: s.title + " — " + s.status })))));
    content.replaceChildren(
      section("Режим мышления", el("p", { cls: "muted", textContent: "Режим пока используется только Brain Core; управление ответами модели — следующий этап." }), modes),
      section("Планировщик", goal, steps, create, feedback),
      ...plans,
    );
  };
  void render();
  return root;
}
