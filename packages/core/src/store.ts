import type { Unsubscribe } from "./events";

export type Listener<S> = (state: S, prev: S) => void;

/** Minimal immutable reactive store. State is only replaced, never mutated. */
export class Store<S extends object> {
  private state: S;
  private readonly listeners = new Set<Listener<S>>();

  constructor(initial: S) {
    this.state = initial;
  }

  get(): S {
    return this.state;
  }

  set(update: Partial<S> | ((s: S) => Partial<S>)): void {
    const patch = typeof update === "function" ? update(this.state) : update;
    const keys = Object.keys(patch) as (keyof S)[];
    if (keys.every((k) => Object.is(this.state[k], patch[k]))) return;
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of [...this.listeners]) {
      try {
        l(this.state, prev);
      } catch (e) {
        queueMicrotask(() => {
          throw e;
        });
      }
    }
  }

  subscribe(listener: Listener<S>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to a derived value; fires only when the selection changes. */
  select<T>(selector: (s: S) => T, listener: (value: T, prev: T) => void): Unsubscribe {
    return this.subscribe((s, p) => {
      const a = selector(s);
      const b = selector(p);
      if (!Object.is(a, b)) listener(a, b);
    });
  }
}
