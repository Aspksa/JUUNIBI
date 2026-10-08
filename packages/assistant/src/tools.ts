import type { ToolSpec } from "./llm";

/** read: harmless; write: changes things; danger: irreversible/outward-facing. */
export type Risk = "read" | "write" | "danger";

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  risk: Risk;
  run(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): () => void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error(`Bad tool name "${tool.name}"`);
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" already registered`);
    this.tools.set(tool.name, tool);
    return () => void this.tools.delete(tool.name);
  }
  get(name: string): Tool | undefined { return this.tools.get(name); }
  list(): Tool[] { return [...this.tools.values()]; }
  specs(): ToolSpec[] {
    return this.list().map(({ name, description, parameters }) => ({ name, description, parameters }));
  }
}
