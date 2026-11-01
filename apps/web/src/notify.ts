import { showToast } from "./toast";

const KEY = "juunibi:announced";
const seen = (): Set<string> => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as string[]); } catch { return new Set(); } };
const remember = (s: Set<string>) => { try { sessionStorage.setItem(KEY, JSON.stringify([...s].slice(-100))); } catch { /* private mode */ } };

export type DeliveryEvent = { id: string; at: string; kind: "presented" | "acknowledged" | "snoozed" | "system-failed"; channel: "in-app" | "system"; };
const JOURNAL_KEY = "juunibi:notification-journal";
export function deliveryJournal(): DeliveryEvent[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is DeliveryEvent =>
      !!x && typeof x === "object" && typeof x.id === "string" && typeof x.at === "string" &&
      ["presented", "acknowledged", "snoozed", "system-failed"].includes(x.kind) &&
      ["in-app", "system"].includes(x.channel)).slice(-500) : [];
  } catch { return []; }
}
export function recordDelivery(id: string, kind: DeliveryEvent["kind"], channel: DeliveryEvent["channel"] = "in-app"): void {
  try {
    const events = deliveryJournal();
    events.push({ id, at: new Date().toISOString(), kind, channel });
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(events.slice(-500)));
  } catch { /* storage may be disabled; never block reminders */ }
}
export function acknowledgeDelivery(id: string): void { recordDelivery(id, "acknowledged"); }

/** Which of the due reminders have not been announced yet. Pure, so it can be tested without a browser. */
export function unannounced(due: { id: string }[], known: Set<string>): { id: string }[] { return due.filter((d) => !known.has(d.id)); }

/**
 * A short buzz and two soft tones. The phone opens JUUNIBI over plain http on Wi-Fi, where system notifications
 * are not allowed, so this is how a reminder gets noticed there while the page is open.
 */
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx && !audio) audio = new Ctx();
    void audio?.resume();
  } catch { /* no audio */ }
}
// browsers let a page play sound only after the person touched it once
if (typeof window !== "undefined") addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
function chime() {
  try { navigator.vibrate?.([180, 80, 180]); } catch { /* not supported */ }
  if (!audio || audio.state !== "running") return;
  for (const [i, f] of [880, 1320].entries()) {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.18;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + 0.17);
  }
}

/** What the owner can do right from a reminder: put it off, or open «Дела». */
export interface DueActions { open(): void; snooze(id: string, minutes: number | "tomorrow"): void }

/**
 * Shows a toast (and a system notification when the owner allowed it) once per due reminder, with «Отложить» buttons.
 * In quiet hours nothing is shown or played: the reminders wait and come together when the quiet hours end.
 */
export function announceDue(due: { id: string; text: string }[], act: DueActions, quiet = false): void {
  if (quiet) return;
  const known = seen();
  const fresh = unannounced(due, known) as { id: string; text: string }[];
  if (!fresh.length) return;
  let system = false;
  let inApp = false;
  if (fresh.length > 3) {
    // a pile after the night or a long pause: one toast instead of a column of them
    inApp = true;
    showToast(`Напоминаний: ${fresh.length}. Первое — ${fresh[0]!.text}`, { action: { label: "Открыть", run: () => { for (const d of fresh) acknowledgeDelivery(d.id); act.open(); } }, ms: 20000 });
  } else for (const d of fresh) {
    inApp = true;
    showToast("Напоминание: " + d.text, { ms: 20000, actions: [
      { label: "10 мин", run: () => { recordDelivery(d.id, "snoozed"); act.snooze(d.id, 10); } }, { label: "1 ч", run: () => { recordDelivery(d.id, "snoozed"); act.snooze(d.id, 60); } },
      { label: "Завтра", run: () => { recordDelivery(d.id, "snoozed"); act.snooze(d.id, "tomorrow"); } }, { label: "Открыть", run: () => { acknowledgeDelivery(d.id); act.open(); } },
    ] });
  }
  try { if (typeof Notification !== "undefined" && Notification.permission === "granted") { new Notification("JUUNIBI", { body: fresh.length > 3 ? `Напоминаний: ${fresh.length}` : fresh.map((d) => d.text).join("\n") }); system = true; } } catch { for (const d of fresh) recordDelivery(d.id, "system-failed", "system"); }
  // the system notification makes its own sound; without it (the phone over http) buzz and chime
  if (!system) chime();
  if (inApp || system) {
    for (const d of fresh) { known.add(d.id); recordDelivery(d.id, "presented", inApp ? "in-app" : "system"); }
    remember(known);
  }
}
