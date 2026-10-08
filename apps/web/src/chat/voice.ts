/** Browser-native dictation and read-aloud. Nothing here talks to our server. */
interface RecResult { isFinal: boolean; 0: { transcript: string } }
interface RecEvent { resultIndex: number; results: ArrayLike<RecResult> }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: RecEvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecCtor = new () => Recognition;
const recCtor = (): RecCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
export const dictationSupported = () => !!recCtor();
export const speechSupported = () => "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

const ERRORS: Record<string, string> = {
  "not-allowed": "Нет доступа к микрофону — разрешите его в браузере.",
  "service-not-allowed": "Распознавание речи отключено в браузере.",
  "no-speech": "Речь не распознана.",
  "audio-capture": "Микрофон не найден.",
  network: "Нет связи со службой распознавания речи.",
};

/** Push-to-toggle dictation (ru-RU). `onText` receives the final text of each phrase; `onInterim` the live guess. */
export class Dictation {
  private rec: Recognition | null = null;
  listening = false;
  constructor(private readonly h: { onText(t: string): void; onInterim(t: string): void; onState(listening: boolean, error?: string): void }) {}

  toggle() { if (this.listening) this.stop(); else this.start(); }
  start() {
    const Ctor = recCtor();
    if (!Ctor || this.listening) return;
    const rec = new Ctor();
    rec.lang = "ru-RU"; rec.interimResults = true; rec.continuous = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) this.h.onText(r[0].transcript.trim()); else interim += r[0].transcript;
      }
      this.h.onInterim(interim);
    };
    rec.onerror = (e) => { this.h.onState(false, ERRORS[e.error] ?? `Ошибка распознавания: ${e.error}`); };
    rec.onend = () => { this.listening = false; this.rec = null; this.h.onInterim(""); this.h.onState(false); };
    try { rec.start(); this.rec = rec; this.listening = true; this.h.onState(true); }
    catch { this.h.onState(false, "Не удалось запустить распознавание."); }
  }
  stop() { this.rec?.stop(); }
}

let current: SpeechSynthesisUtterance | null = null;
export function stopSpeaking() { if (speechSupported()) { speechSynthesis.cancel(); current = null; } }
export function isSpeaking() { return current !== null; }
export function speak(text: string, onEnd: () => void) {
  if (!speechSupported() || !text) return onEnd();
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ru-RU";
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("ru"));
  if (voice) u.voice = voice;
  u.onend = u.onerror = () => { if (current === u) current = null; onEnd(); };
  current = u;
  speechSynthesis.speak(u);
}
