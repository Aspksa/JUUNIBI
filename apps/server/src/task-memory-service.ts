import type { Note, TaskEvent } from "./organizer";

const MAX_BUCKETS = 300;
const MAX_LABEL = 80;
const STOP = new Set([
  "это","как","для","или","его","её","она","они","надо","нужно","сделать","делать","задача","дело",
  "the","and","for","with","from","this","that","todo","task",
]);

export type TaskMemoryKind = "pattern" | "project" | "area";

export interface TaskMemoryBucket {
  key: string;
  label: string;
  kind: TaskMemoryKind;
  seen: number;
  completed: number;
  moved: number;
  autoMoved: number;
  undone: number;
  onTime: number;
  overdueDone: number;
  estimateTotal: number;
  estimateSamples: number;
  lastSeenAt: string;
}

export interface TaskMemorySnapshot {
  version: 1;
  observations: number;
  buckets: TaskMemoryBucket[];
}

export interface TaskMemoryRecall {
  confidence: number;
  observations: number;
  friction: number;
  onTimeRate?: number;
  learnedEstimateMinutes?: number;
  riskBoost: number;
  reasons: string[];
}

export interface TaskMemorySummary {
  totals: {
    observations: number;
    buckets: number;
    completed: number;
    moved: number;
    overdueDone: number;
  };
  patterns: Array<{
    label: string;
    observations: number;
    moved: number;
    completed: number;
    friction: number;
    learnedEstimateMinutes?: number;
  }>;
  projects: Array<{
    label: string;
    observations: number;
    moved: number;
    completed: number;
    onTimeRate?: number;
  }>;
  note: string;
}

const nint = (value: unknown): number =>
  Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;

const cleanLabel = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, MAX_LABEL) : "";

const normalizedWords = (value: string): string[] =>
  value
    .toLocaleLowerCase("ru-RU")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word));

const patternLabel = (value: string): string => {
  const words = normalizedWords(value).slice(0, 3);
  return words.length ? words.join(" ") : value.trim().toLocaleLowerCase("ru-RU").slice(0, 40) || "прочее";
};

const bucketObservations = (bucket: TaskMemoryBucket): number =>
  bucket.completed + bucket.moved + bucket.undone;

const roundEstimate = (value: number): number =>
  Math.max(5, Math.min(480, Math.round(value / 5) * 5));

/**
 * Compact durable behavioural memory for Organizer.
 *
 * It learns only from actual task events. It never invents facts, rewrites tasks or changes code.
 * Aggregates survive removal of old tasks and trimming of the event journal.
 */
export class TaskMemoryService {
  private buckets = new Map<string, TaskMemoryBucket>();
  private observations = 0;

  snapshot(): TaskMemorySnapshot {
    return {
      version: 1,
      observations: this.observations,
      buckets: [...this.buckets.values()].map((bucket) => ({ ...bucket })),
    };
  }

  load(value: unknown): boolean {
    const raw = value as Partial<TaskMemorySnapshot> | null;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.buckets)) return false;

    const next = new Map<string, TaskMemoryBucket>();
    for (const item of raw.buckets.slice(-MAX_BUCKETS * 2)) {
      const bucket = item as Partial<TaskMemoryBucket> | null;
      if (
        !bucket ||
        typeof bucket.key !== "string" ||
        bucket.key.length < 3 ||
        bucket.key.length > 180 ||
        (bucket.kind !== "pattern" && bucket.kind !== "project" && bucket.kind !== "area")
      ) continue;
      const label = cleanLabel(bucket.label);
      if (!label) continue;
      const lastSeenAt =
        typeof bucket.lastSeenAt === "string" && Number.isFinite(Date.parse(bucket.lastSeenAt))
          ? bucket.lastSeenAt
          : new Date(0).toISOString();
      next.set(bucket.key, {
        key: bucket.key,
        label,
        kind: bucket.kind,
        seen: nint(bucket.seen),
        completed: nint(bucket.completed),
        moved: nint(bucket.moved),
        autoMoved: nint(bucket.autoMoved),
        undone: nint(bucket.undone),
        onTime: nint(bucket.onTime),
        overdueDone: nint(bucket.overdueDone),
        estimateTotal:
          typeof bucket.estimateTotal === "number" && Number.isFinite(bucket.estimateTotal) && bucket.estimateTotal >= 0
            ? Math.min(bucket.estimateTotal, 10_000_000)
            : 0,
        estimateSamples: nint(bucket.estimateSamples),
        lastSeenAt,
      });
    }

    this.buckets = next;
    this.observations = nint(raw.observations);
    this.prune();
    return true;
  }

  rebuild(
    history: readonly TaskEvent[],
    notes: readonly Note[],
    areaOf: (note: Note) => "work" | "personal",
  ): void {
    this.buckets.clear();
    this.observations = 0;
    const byId = new Map(notes.map((note) => [note.id, note]));

    for (const event of history) {
      if (!event.todo) continue;
      const current = byId.get(event.id);
      const note: Note = current ?? {
        id: event.id,
        kind: "todo",
        text: event.text,
        done: event.kind === "done",
        createdAt: event.at,
      };
      this.observe(event, note, areaOf(note));
    }

    const ids = new Set(history.map((event) => event.id));
    for (const note of notes) {
      if (note.kind !== "todo" || ids.has(note.id)) continue;
      const add: TaskEvent = {
        at: note.createdAt,
        id: note.id,
        kind: "add",
        text: note.text,
        todo: true,
      };
      this.observe(add, note, areaOf(note));
      if (note.done) {
        this.observe({
          at: note.completedAt ?? note.createdAt,
          id: note.id,
          kind: "done",
          text: note.text,
          todo: true,
        }, note, areaOf(note));
      }
    }
  }

  observe(event: TaskEvent, note: Note, area: "work" | "personal"): void {
    if (!event.todo || note.kind !== "todo") return;

    const targets = this.keysFor(note, area);
    this.observations++;

    for (const target of targets) {
      const bucket = this.buckets.get(target.key) ?? {
        ...target,
        seen: 0,
        completed: 0,
        moved: 0,
        autoMoved: 0,
        undone: 0,
        onTime: 0,
        overdueDone: 0,
        estimateTotal: 0,
        estimateSamples: 0,
        lastSeenAt: event.at,
      };

      bucket.lastSeenAt = event.at;
      if (event.kind === "add") bucket.seen++;
      if (
        event.kind === "move" &&
        event.from !== undefined &&
        event.from !== null &&
        event.to !== undefined &&
        event.to !== null &&
        event.from !== event.to
      ) {
        bucket.moved++;
        if (event.auto) bucket.autoMoved++;
      }
      if (event.kind === "undone") bucket.undone++;
      if (event.kind === "done") {
        bucket.completed++;
        if (note.estimateMinutes) {
          bucket.estimateTotal += note.estimateMinutes;
          bucket.estimateSamples++;
        }
        if (note.dueAt) {
          if (Date.parse(event.at) <= Date.parse(note.dueAt)) bucket.onTime++;
          else bucket.overdueDone++;
        }
      }

      this.buckets.set(bucket.key, bucket);
    }

    this.prune();
  }

  recall(note: Note, area: "work" | "personal"): TaskMemoryRecall {
    const entries = this.keysFor(note, area)
      .map((target) => {
        const bucket = this.buckets.get(target.key);
        const weight = target.kind === "pattern" ? 3 : target.kind === "project" ? 2 : 1;
        return bucket ? { bucket, weight } : null;
      })
      .filter((entry): entry is { bucket: TaskMemoryBucket; weight: number } => !!entry);

    let weightedObs = 0;
    let weightedMoved = 0;
    let weightedResolved = 0;
    let weightedOnTime = 0;
    let weightedDueOutcomes = 0;
    let estimateTotal = 0;
    let estimateWeight = 0;

    for (const { bucket, weight } of entries) {
      const observations = bucketObservations(bucket);
      weightedObs += observations * weight;
      weightedMoved += bucket.moved * weight;
      weightedResolved += (bucket.completed + bucket.moved) * weight;
      weightedOnTime += bucket.onTime * weight;
      weightedDueOutcomes += (bucket.onTime + bucket.overdueDone) * weight;
      if (bucket.estimateSamples) {
        estimateTotal += (bucket.estimateTotal / bucket.estimateSamples) * bucket.estimateSamples * weight;
        estimateWeight += bucket.estimateSamples * weight;
      }
    }

    const friction = weightedResolved ? weightedMoved / weightedResolved : 0;
    const onTimeRate = weightedDueOutcomes ? weightedOnTime / weightedDueOutcomes : undefined;
    const learnedEstimateMinutes = estimateWeight >= 4 ? roundEstimate(estimateTotal / estimateWeight) : undefined;
    const confidence = Math.min(100, Math.round(weightedObs / 12 * 100));
    const reasons: string[] = [];
    let riskBoost = 0;

    const pattern = entries.find((entry) => entry.bucket.kind === "pattern")?.bucket;
    if (pattern && pattern.moved >= 2 && pattern.moved >= pattern.completed) {
      reasons.push("Похожие дела часто переносились");
      riskBoost += pattern.moved >= 4 ? 14 : 9;
    }

    const project = entries.find((entry) => entry.bucket.kind === "project")?.bucket;
    if (project && project.overdueDone >= 2 && project.overdueDone > project.onTime) {
      reasons.push(`В проекте «${project.label}» сроки часто срывались`);
      riskBoost += 7;
    }

    if (friction >= 0.55 && weightedResolved >= 5) {
      if (!reasons.includes("Похожие дела часто переносились")) reasons.push("История показывает высокий риск откладывания");
      riskBoost += 6;
    }

    if (learnedEstimateMinutes && !note.estimateMinutes && confidence >= 25) {
      reasons.push(`Память: похожие дела обычно оцениваются примерно в ${learnedEstimateMinutes} мин`);
    }

    return {
      confidence,
      observations: Math.round(weightedObs),
      friction: Math.round(friction * 100) / 100,
      ...(onTimeRate !== undefined ? { onTimeRate: Math.round(onTimeRate * 100) / 100 } : {}),
      ...(learnedEstimateMinutes ? { learnedEstimateMinutes } : {}),
      riskBoost: Math.min(24, riskBoost),
      reasons: reasons.slice(0, 3),
    };
  }

  summary(): TaskMemorySummary {
    const all = [...this.buckets.values()];
    const completed = all.filter((bucket) => bucket.kind === "pattern").reduce((sum, bucket) => sum + bucket.completed, 0);
    const moved = all.filter((bucket) => bucket.kind === "pattern").reduce((sum, bucket) => sum + bucket.moved, 0);
    const overdueDone = all.filter((bucket) => bucket.kind === "pattern").reduce((sum, bucket) => sum + bucket.overdueDone, 0);

    const describe = (bucket: TaskMemoryBucket) => {
      const resolved = bucket.completed + bucket.moved;
      return {
        label: bucket.label,
        observations: bucketObservations(bucket),
        moved: bucket.moved,
        completed: bucket.completed,
        friction: resolved ? Math.round(bucket.moved / resolved * 100) / 100 : 0,
        ...(bucket.estimateSamples >= 2
          ? { learnedEstimateMinutes: roundEstimate(bucket.estimateTotal / bucket.estimateSamples) }
          : {}),
      };
    };

    const patterns = all
      .filter((bucket) => bucket.kind === "pattern" && bucketObservations(bucket) > 0)
      .sort((a, b) => bucketObservations(b) - bucketObservations(a) || b.moved - a.moved)
      .slice(0, 12)
      .map(describe);

    const projects = all
      .filter((bucket) => bucket.kind === "project" && bucketObservations(bucket) > 0)
      .sort((a, b) => bucketObservations(b) - bucketObservations(a))
      .slice(0, 12)
      .map((bucket) => {
        const due = bucket.onTime + bucket.overdueDone;
        return {
          label: bucket.label,
          observations: bucketObservations(bucket),
          moved: bucket.moved,
          completed: bucket.completed,
          ...(due ? { onTimeRate: Math.round(bucket.onTime / due * 100) / 100 } : {}),
        };
      });

    return {
      totals: {
        observations: this.observations,
        buckets: this.buckets.size,
        completed,
        moved,
        overdueDone,
      },
      patterns,
      projects,
      note: "Память основана только на реальных действиях с делами; она влияет на советы, но ничего не выполняет сама.",
    };
  }

  private keysFor(note: Note, area: "work" | "personal"): Array<Pick<TaskMemoryBucket, "key" | "label" | "kind">> {
    const pattern = patternLabel(note.text);
    const result: Array<Pick<TaskMemoryBucket, "key" | "label" | "kind">> = [
      { key: "pattern:" + pattern, label: pattern, kind: "pattern" },
      { key: "area:" + area, label: area === "work" ? "Работа" : "Личное", kind: "area" },
    ];
    if (note.project) {
      const project = note.project.trim();
      result.push({
        key: "project:" + project.toLocaleLowerCase("ru-RU"),
        label: project.slice(0, MAX_LABEL),
        kind: "project",
      });
    }
    return result;
  }

  private prune(): void {
    if (this.buckets.size <= MAX_BUCKETS) return;
    const ordered = [...this.buckets.values()].sort((a, b) => {
      const signal = bucketObservations(a) - bucketObservations(b);
      if (signal) return signal;
      return a.lastSeenAt.localeCompare(b.lastSeenAt);
    });
    for (const bucket of ordered.slice(0, this.buckets.size - MAX_BUCKETS)) {
      this.buckets.delete(bucket.key);
    }
  }
}
