export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export interface LogEntry {
  level: Exclude<LogLevel, "silent">;
  scope: string;
  message: string;
  data?: unknown;
  time: number;
}
export type LogSink = (entry: LogEntry) => void;

export const consoleSink: LogSink = (e) => {
  const fn = e.level === "debug" ? console.debug : console[e.level];
  fn(`[${e.scope}] ${e.message}`, ...(e.data === undefined ? [] : [e.data]));
};

export class Logger {
  constructor(
    private readonly scope = "juunibi",
    private level: LogLevel = "info",
    private readonly sinks: LogSink[] = [consoleSink],
  ) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }
  child(scope: string): Logger {
    return new Logger(`${this.scope}:${scope}`, this.level, this.sinks);
  }
  private emit(level: Exclude<LogLevel, "silent">, message: string, data?: unknown): void {
    if (order[level] < order[this.level]) return;
    const entry: LogEntry = { level, scope: this.scope, message, time: Date.now() };
    if (data !== undefined) entry.data = data;
    for (const s of this.sinks) {
      try {
        s(entry);
      } catch {
        /* a broken sink must never break the app */
      }
    }
  }
  debug(m: string, d?: unknown): void { this.emit("debug", m, d); }
  info(m: string, d?: unknown): void { this.emit("info", m, d); }
  warn(m: string, d?: unknown): void { this.emit("warn", m, d); }
  error(m: string, d?: unknown): void { this.emit("error", m, d); }
}
