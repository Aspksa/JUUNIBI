/** «В дела» under a chat message: the selected words (or the first sentence) become a to-do or a reminder. */
import { api } from "../api";
import { iconButton } from "../dom";
import { refreshBrief } from "../state";
import { showToast } from "../toast";
import { parseQuick, taskTextFrom } from "../pages/quick-entry";
import { saveQuick, savedText } from "../pages/tasks";

export function toTasksButton(content: string, host: () => HTMLElement | null): HTMLButtonElement {
  return iconButton("list", "В дела: выделенное или первое предложение", async () => {
    const s = window.getSelection();
    const root = host();
    const inside = s && root && !s.isCollapsed && s.anchorNode && root.contains(s.anchorNode) ? s.toString() : "";
    const text = taskTextFrom(content, inside);
    if (!text) { showToast("Нечего добавить: выделите текст в сообщении."); return; }
    const p = parseQuick(text, new Date(), "auto");
    const r = await saveQuick(p.kind === "note" ? { ...p, kind: "todo" } : p);
    if (!r.ok) { showToast(r.error.message, { ms: 8000 }); return; }
    const id = r.value.id;
    void refreshBrief();
    showToast(savedText(p.kind === "note" ? { ...p, kind: "todo" } : p) + ": «" + p.text.slice(0, 60) + "»", { ms: 6000, action: { label: "Отменить", run: () => {
      void (p.kind === "reminder" ? api.removeReminder(id) : api.removeNote(id)).then(() => refreshBrief());
    } } });
  }, "icon-btn sm");
}
