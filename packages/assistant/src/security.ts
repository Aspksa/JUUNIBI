import type { Risk } from "./tools";

export interface ApprovalRequest {
  tool: string;
  args: Record<string, unknown>;
  risk: Risk;
}
export interface PendingApproval extends ApprovalRequest {
  id: string;
  createdAt: number;
  expiresAt: number;
}
export interface AuditEvent {
  id: string;
  at: number;
  tool: string;
  risk: Risk;
  decision: "requested" | "approved" | "denied" | "expired";
  approvalId: string;
}
export type AuditSink = (event: AuditEvent) => Promise<void> | void;

/** Fail closed: permissions are single-use, bound to an immutable copy of tool arguments. */
export class ApprovalGate {
  private pending = new Map<string, { request: PendingApproval; finish: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  private events: AuditEvent[] = [];
  constructor(private readonly audit?: AuditSink, private readonly ttlMs = 120_000) {}

  list(): PendingApproval[] {
    return [...this.pending.values()].map(({ request }) => structuredClone(request));
  }
  history(): AuditEvent[] { return this.events.map((e) => ({ ...e })); }

  private record(req: PendingApproval, decision: AuditEvent["decision"]): void {
    const event: AuditEvent = { id: crypto.randomUUID(), at: Date.now(), tool: req.tool, risk: req.risk, decision, approvalId: req.id };
    this.events.push(event);
    if (this.events.length > 2000) this.events.shift();
    // An audit persistence failure must not accidentally grant permission.
    try { void Promise.resolve(this.audit?.(event)).catch(() => {}); } catch { /* log sink failed */ }
  }

  request(input: ApprovalRequest, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || input.risk === "read") return Promise.resolve(false);
    const request: PendingApproval = {
      tool: input.tool, args: structuredClone(input.args), risk: input.risk,
      id: crypto.randomUUID(), createdAt: Date.now(), expiresAt: Date.now() + this.ttlMs,
    };
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        const current = this.pending.get(request.id);
        if (current) { clearTimeout(current.timer); this.pending.delete(request.id); }
        signal?.removeEventListener("abort", abort);
        this.record(request, ok ? "approved" : signal?.aborted ? "denied" : Date.now() >= request.expiresAt ? "expired" : "denied");
        resolve(ok);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), this.ttlMs);
      this.pending.set(request.id, { request, finish, timer });
      signal?.addEventListener("abort", abort, { once: true });
      this.record(request, "requested");
      if (signal?.aborted) finish(false);
    });
  }

  decide(id: string, approve: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.finish(approve && Date.now() < entry.request.expiresAt);
    return true;
  }
  denyAll(): void { for (const id of [...this.pending.keys()]) this.decide(id, false); }
}

/** Validate supported JSON Schema keywords before invoking any tool. Reject unknown args. */
export function validateToolArgs(schema: {
  type: "object"; properties?: Record<string, unknown>; required?: string[];
}, args: Record<string, unknown>): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "Аргументы должны быть объектом";
  const props = schema.properties ?? {};
  for (const key of schema.required ?? []) if (!(key in args)) return `Не хватает аргумента: ${key}`;
  for (const [key, value] of Object.entries(args)) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) return `Неизвестный аргумент: ${key}`;
    const def = props[key] as { type?: string; enum?: unknown[]; minLength?: number; maxLength?: number } | undefined;
    if (!def || typeof def !== "object") return `Некорректная схема: ${key}`;
    if (def.type) {
      const ok = def.type === "array" ? Array.isArray(value)
        : def.type === "integer" ? Number.isInteger(value)
        : def.type === "null" ? value === null
        : def.type === "object" ? !!value && typeof value === "object" && !Array.isArray(value)
        : typeof value === def.type;
      if (!ok) return `Неверный тип аргумента: ${key}`;
    }
    if (def.enum && !def.enum.includes(value)) return `Недопустимое значение: ${key}`;
    if (typeof value === "string") {
      if (def.minLength !== undefined && value.length < def.minLength) return `Слишком короткий аргумент: ${key}`;
      if (def.maxLength !== undefined && value.length > def.maxLength) return `Слишком длинный аргумент: ${key}`;
    }
  }
  return null;
}
