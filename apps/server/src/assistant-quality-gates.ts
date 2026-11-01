/** Auditable, deterministic checks before a tool result is represented as success. */
export interface ToolAudit { id: string; name: string; startedAt: number; finishedAt: number; ok: boolean; error?: string; approvalId?: string }
export class ToolAuditJournal {
  private entries: ToolAudit[] = [];
  constructor(private readonly capacity = 500) {}
  record(entry: ToolAudit): void {
    if (!entry.id || !entry.name || !Number.isFinite(entry.startedAt) || !Number.isFinite(entry.finishedAt)) throw Error("Invalid audit entry");
    if (this.entries.some(x => x.id === entry.id)) return;
    this.entries.push({ ...entry, error: entry.error?.slice(0, 300) });
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }
  list(): ToolAudit[] { return this.entries.map(x => ({ ...x })); }
  failures(name?: string): number { return this.entries.filter(x => !x.ok && (!name || x.name === name)).length; }
}
export function verifyAssistantAnswer(answer: string, options: { toolCalls?: readonly ToolAudit[]; claimsToolSuccess?: boolean } = {}) {
  const issues: string[] = [];
  if (!answer.trim()) issues.push("empty-answer");
  if (options.claimsToolSuccess && (!options.toolCalls?.length || options.toolCalls.some(x => !x.ok))) issues.push("unverified-tool-success");
  return { passed: issues.length === 0, issues };
}
