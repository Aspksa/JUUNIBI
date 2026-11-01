import type { ToolSpec } from "./llm";
import type { DangerousActionPlan } from "./action-review";

/** read: harmless; write: changes things; danger: irreversible/outward-facing. */
export type Risk = "read" | "write" | "danger";

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  risk: Risk;
  /** Server-defined preflight plan; required for danger tools. */
  actionPlan?: DangerousActionPlan;
  run(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly owners = new Map<string, string>();

  register(tool: Tool, owner = "runtime"): () => void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error(`Bad tool name "${tool.name}"`);
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" already registered`);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(owner)) throw new Error(`Bad tool owner "${owner}"`);
    this.tools.set(tool.name, tool);
    this.owners.set(tool.name, owner);
    return () => { if (this.tools.get(tool.name) === tool) { this.tools.delete(tool.name); this.owners.delete(tool.name); } };
  }
  /** Read-only inventory for auditing existing capabilities before registering new ones. */
  capabilities(): { name: string; owner: string; risk: Risk }[] {
    return this.list().map(tool => ({ name: tool.name, owner: this.owners.get(tool.name) ?? "runtime", risk: tool.risk }));
  }
  /** Advisory inventory of identical read-only tool schemas; never merges permissions or executions. */
  potentialOverlaps(): { names: string[]; owners: string[] }[] {
    const groups = new Map<string, Tool[]>();
    const stable = (value: unknown): string => {
      if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
      if (value && typeof value === "object") return "{" + Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + stable(v)).join(",") + "}";
      return JSON.stringify(value);
    };
    for (const tool of this.tools.values()) {
      if (tool.risk !== "read") continue;
      const key = stable({ description: tool.description.trim().normalize("NFKC").toLocaleLowerCase("ru"),
        parameters: tool.parameters });
      groups.set(key, [...(groups.get(key) ?? []), tool]);
    }
    return [...groups.values()].filter(group => group.length > 1)
      .map(group => ({ names: group.map(x => x.name).sort(),
        owners: [...new Set(group.map(x => this.owners.get(x.name) ?? "runtime"))].sort() }))
      .sort((a, b) => a.names[0]!.localeCompare(b.names[0]!));
  }
  get(name: string): Tool | undefined { return this.tools.get(name); }
  list(): Tool[] { return [...this.tools.values()]; }
  specs(): ToolSpec[] {
    return this.list().map(({ name, description, parameters }) => ({ name, description, parameters }));
  }
}
