import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmbeddingProvider } from "@juunibi/assistant";

type Entry = { key: string; vector: number[] };
const valid = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.length <= 4096 && v.every(x => typeof x === "number" && Number.isFinite(x));
/** Bounded, disk-backed vector cache. Keys are hashes of model ID and text, never raw contents. */
export class KnowledgeVectorCache {
  private loaded = false;
  private values = new Map<string, number[]>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!Array.isArray(raw)) return;
      for (const row of raw.slice(-200) as Entry[]) {
        if (row && typeof row.key === "string" && /^[a-f0-9]{64}$/.test(row.key) && valid(row.vector))
          this.values.set(row.key, row.vector);
      }
    } catch { /* Missing or corrupted cache must never disable lexical search. */ }
  }
  async embed(provider: EmbeddingProvider, text: string): Promise<number[]> {
    await this.load();
    const model = provider.id ?? "unspecified";
    const key = createHash("sha256").update(model + "\0" + text).digest("hex");
    const cached = this.values.get(key);
    if (cached) return cached.slice();
    const vector = await provider.embed(text);
    if (!valid(vector)) throw new Error("Invalid embedding vector");
    this.values.delete(key);
    this.values.set(key, vector.slice());
    while (this.values.size > 200) this.values.delete(this.values.keys().next().value!);
    const snapshot: Entry[] = [...this.values].map(([k, v]) => ({key:k, vector:v}));
    this.queue = this.queue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), {recursive:true});
      const tmp = this.file + ".tmp";
      await writeFile(tmp, JSON.stringify(snapshot), {mode:0o600});
      await rename(tmp, this.file);
    });
    return vector.slice();
  }
  flush() { return this.queue; }
}
