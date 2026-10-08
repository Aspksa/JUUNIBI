import { EventBus } from "./events";
import { Logger } from "./logger";
import type { Unsubscribe } from "./events";

export interface KernelEvents extends Record<string, unknown> {
  "kernel:started": undefined;
  "kernel:stopped": undefined;
  "plugin:started": { name: string };
  "plugin:failed": { name: string; error: Error };
}

export interface PluginContext<E extends Record<string, unknown>> {
  bus: EventBus<E & KernelEvents>;
  log: Logger;
  /** Register cleanup that runs (in reverse order) when the plugin stops. */
  onStop(fn: () => void | Promise<void>): void;
  /** Look up a service provided by a dependency. */
  service<T>(key: string): T;
  provide(key: string, value: unknown): void;
}

export interface Plugin<E extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  deps?: string[];
  start(ctx: PluginContext<E>): void | Promise<void>;
}

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

/** Plugin host: resolves dependency order, isolates failures, stops cleanly. */
export class Kernel<E extends Record<string, unknown> = Record<string, unknown>> {
  readonly bus: EventBus<E & KernelEvents>;
  readonly log: Logger;
  private readonly plugins = new Map<string, Plugin<E>>();
  private readonly services = new Map<string, unknown>();
  private readonly cleanups: { name: string; fn: () => void | Promise<void> }[] = [];
  private readonly failed = new Set<string>();
  private running = false;

  constructor(log = new Logger()) {
    this.log = log;
    this.bus = new EventBus((ev, e) => this.log.error(`handler for "${String(ev)}" threw`, e));
  }

  register(plugin: Plugin<E>): this {
    if (this.running) throw new Error("Cannot register plugins after start()");
    if (this.plugins.has(plugin.name)) throw new Error(`Duplicate plugin "${plugin.name}"`);
    this.plugins.set(plugin.name, plugin);
    return this;
  }

  /** Topological order; throws on missing deps or cycles. */
  order(): Plugin<E>[] {
    const out: Plugin<E>[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (name: string, path: string[]) => {
      const p = this.plugins.get(name);
      if (!p) throw new Error(`Missing plugin "${name}" required by ${path.at(-1) ?? "root"}`);
      if (state.get(name) === 2) return;
      if (state.get(name) === 1) throw new Error(`Dependency cycle: ${[...path, name].join(" -> ")}`);
      state.set(name, 1);
      for (const d of p.deps ?? []) visit(d, [...path, name]);
      state.set(name, 2);
      out.push(p);
    };
    for (const n of this.plugins.keys()) visit(n, []);
    return out;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const ordered = this.order(); // validate before starting anything
    this.running = true;
    for (const p of ordered) {
      if ((p.deps ?? []).some((d) => this.failed.has(d))) {
        this.failed.add(p.name);
        this.log.warn(`skipping "${p.name}": dependency failed`);
        continue;
      }
      const local: (() => void | Promise<void>)[] = [];
      const ctx: PluginContext<E> = {
        bus: this.bus,
        log: this.log.child(p.name),
        onStop: (fn) => void local.push(fn),
        service: <T>(key: string) => {
          if (!this.services.has(key)) throw new Error(`Service "${key}" not provided`);
          return this.services.get(key) as T;
        },
        provide: (key, value) => void this.services.set(key, value),
      };
      try {
        await p.start(ctx);
        for (const fn of local) this.cleanups.push({ name: p.name, fn });
        this.bus.emit("plugin:started", { name: p.name } as never);
      } catch (e) {
        this.failed.add(p.name);
        for (const fn of local.reverse()) await this.safe(p.name, fn);
        const error = toError(e);
        this.log.error(`plugin "${p.name}" failed to start`, error);
        this.bus.emit("plugin:failed", { name: p.name, error } as never);
      }
    }
    this.bus.emit("kernel:started", undefined as never);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const c of this.cleanups.reverse()) await this.safe(c.name, c.fn);
    this.cleanups.length = 0;
    this.services.clear();
    this.failed.clear();
    this.bus.emit("kernel:stopped", undefined as never);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async safe(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.log.error(`cleanup of "${name}" threw`, e);
    }
  }
}

export type { Unsubscribe };
