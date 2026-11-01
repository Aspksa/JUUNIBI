import { el } from "../dom";
type Snapshot = { version: number; traits: Record<string, number>; acceptedLessons: string[] };
export function personalityPanel(): HTMLElement {
  const status = el("p", { textContent: "Загрузка личности…" });
  const body = el("div");
  const panel = el("section", { cls: "pg-card set-card" }, el("h2", { textContent: "Личность JUUNIBI" }), status, body);
  async function load() {
    try {
      const response = await fetch("/api/personality");
      if (!response.ok) throw new Error("Профиль недоступен");
      const profile = await response.json() as Snapshot;
      status.textContent = "Версия " + profile.version;
      body.replaceChildren(...Object.entries(profile.traits).map(([trait, value]) => {
        const button = el("button", { type: "button", textContent: "Изменить +0.1" });
        button.addEventListener("click", async () => {
          if (!confirm("Изменить характеристику " + trait + "?")) return;
          const result = await fetch("/api/personality/trait", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trait, delta: 0.1, approved: true }) });
          if (result.ok) void load(); else status.textContent = "Изменение не сохранено";
        });
        return el("div", { cls: "set-row" }, el("span", { textContent: trait + ": " + value.toFixed(2) }), button);
      }));
    } catch { status.textContent = "Профиль недоступен"; }
  }
  void load();
  return panel;
}
