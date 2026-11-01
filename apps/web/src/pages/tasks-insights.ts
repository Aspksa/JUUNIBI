/** Non-invasive recommendations for the existing «Дела» UI. */
import type { Note } from "../api";
export type TaskInsight = { id: string; kind: "overdue" | "stalled" | "duplicate" | "priority"; taskId: string; message: string; relatedId?: string };
const normalized = (s: string) => s.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
export function taskInsights(notes: readonly Note[], now = Date.now()): TaskInsight[] {
  const result: TaskInsight[] = [], seen = new Map<string, string>();
  for (const n of notes) {
    if (n.kind !== "todo" || n.done || n.auto) continue;
    const key = normalized(n.text);
    if (key.length >= 5) {
      const first = seen.get(key);
      if (first && first !== n.id) result.push({ id: "duplicate:" + n.id, kind: "duplicate", taskId: n.id, relatedId: first, message: "Возможно, это повтор другой задачи" });
      else seen.set(key, n.id);
    }
    const due = n.dueAt ? Date.parse(n.dueAt) : NaN;
    if (Number.isFinite(due) && due < now) result.push({ id: "overdue:" + n.id, kind: "overdue", taskId: n.id, message: "Срок прошёл — предложить новую дату" });
    const activity = Date.parse(n.statusAt ?? n.createdAt);
    if (Number.isFinite(activity) && now - activity >= 7 * 86_400_000 && (n.status === "doing" || n.status === "waiting"))
      result.push({ id: "stalled:" + n.id, kind: "stalled", taskId: n.id, message: "Нет изменений более недели" });
    if (n.priority !== "high" && Number.isFinite(due) && due >= now && due - now <= 86_400_000)
      result.push({ id: "priority:" + n.id, kind: "priority", taskId: n.id, message: "Срок близко — проверить приоритет" });
  }
  return result;
}
