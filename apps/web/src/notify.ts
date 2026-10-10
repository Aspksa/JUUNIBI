import { showToast } from "./toast";

const KEY = "juunibi:announced";
const seen = (): Set<string> => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as string[]); } catch { return new Set(); } };
const remember = (s: Set<string>) => { try { sessionStorage.setItem(KEY, JSON.stringify([...s].slice(-100))); } catch { /* private mode */ } };

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

/** Shows a toast (and a system notification when the owner allowed it) once per due reminder. */
export function announceDue(due: { id: string; text: string }[], open: () => void): void {
  const known = seen();
  const fresh = unannounced(due, known) as { id: string; text: string }[];
  if (!fresh.length) return;
  for (const d of fresh) known.add(d.id);
  remember(known);
  let system = false;
  for (const d of fresh.slice(0, 3)) {
    showToast("Напоминание: " + d.text, { action: { label: "Открыть", run: open }, ms: 15000 });
    try { if (typeof Notification !== "undefined" && Notification.permission === "granted") { new Notification("JUUNIBI", { body: d.text }); system = true; } } catch { /* not supported */ }
  }
  // the system notification makes its own sound; without it (the phone over http) buzz and chime
  if (!system) chime();
}
