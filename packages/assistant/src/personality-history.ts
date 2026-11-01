import type { StorageAdapter } from "./memory";
import { initialPersonality, acceptLesson, evolveTrait, type PersonalitySnapshot, type LessonProposal, type Trait } from "./personality";

export class PersonalityHistory {
  private versions: PersonalitySnapshot[] = [initialPersonality()];
  private readonly ready: Promise<void>;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: StorageAdapter) {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const raw = await this.storage.load();
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) throw new Error("Invalid personality history");
    const traits = ["warmth", "curiosity", "brevity", "initiative"] as const;
    for (const item of parsed) {
      if (!item || typeof item !== "object") throw new Error("Invalid personality version");
      const snapshot = item as Partial<PersonalitySnapshot>;
      if (!Number.isSafeInteger(snapshot.version) || (snapshot.version ?? 0) < 1 ||
          !snapshot.traits || traits.some(k => !Number.isFinite(snapshot.traits?.[k]) || snapshot.traits![k] < 0 || snapshot.traits![k] > 1) ||
          !Array.isArray(snapshot.acceptedLessons) || snapshot.acceptedLessons.length > 2000 ||
          snapshot.acceptedLessons.some(x => typeof x !== "string" || x.length > 200)) throw new Error("Invalid personality version");
    }
    this.versions = structuredClone(parsed as PersonalitySnapshot[]);
  }

  async current(): Promise<PersonalitySnapshot> {
    await this.ready;
    await this.pending;
    return structuredClone(this.versions[this.versions.length - 1]!);
  }

  private update(change: (current: PersonalitySnapshot) => PersonalitySnapshot): Promise<PersonalitySnapshot> {
    const operation = this.pending.then(async () => {
      await this.ready;
      const current = this.versions[this.versions.length - 1]!;
      const next = change(current);
      if (next !== current) {
        const versions = [...this.versions.slice(-99), next];
        await this.storage.save(JSON.stringify(versions));
        this.versions = versions;
      }
      return structuredClone(this.versions[this.versions.length - 1]!);
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  approveLesson(proposal: LessonProposal, approved: boolean) {
    return this.update(current => acceptLesson(current, proposal, approved));
  }

  adjustTrait(trait: Trait, delta: number, approved: boolean) {
    return this.update(current => evolveTrait(current, trait, delta, approved));
  }

  restore(version: number, approved: boolean) {
    return this.update(current => {
      if (!approved) return current;
      const previous = this.versions.find(item => item.version === version);
      if (!previous) throw new Error("Unknown personality version");
      return { ...structuredClone(previous), version: current.version + 1 };
    });
  }
}
