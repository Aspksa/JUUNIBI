import { showToast } from "./toast";

const KEY = "juunibi:announced";
const seen = (): Set<string> => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as string[]); } catch { return new Set(); } };
const remember = (s: Set<string>) => { try { sessionStorage.setItem(KEY, JSON.stringify([...s].slice(-100))); } catch { /* private mode */ } };

/** Which of the due reminders have not been announced yet. Pure, so it can be tested without a browser. */
export function unannounced(due: { id: string }[], known: Set<string>): { id: string }[] { return due.filter((d) => !known.has(d.id)); }

/** Shows a toast (and a system notification when the owner allowed it) once per due reminder. */
export function announceDue(due: { id: string; text: string }[], open: () => void): void {
  const known = seen();
  const fresh = unannounced(due, known) as { id: string; text: string }[];
  if (!fresh.length) return;
  for (const d of fresh) known.add(d.id);
  remember(known);
  for (const d of fresh.slice(0, 3)) {
    showToast("Напоминание: " + d.text, { action: { label: "Открыть", run: open }, ms: 15000 });
    try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("JUUNIBI", { body: d.text }); } catch { /* not supported */ }
  }
}
