import { randomUUID } from "node:crypto";
import type { Mission, Note } from "./organizer";

const MAX_MISSIONS = 100;
const MAX_TEXT = 500;

const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_TEXT) {
    throw bad(`${label}: от 1 до ${MAX_TEXT} символов`);
  }
  return value.trim();
};

export interface MissionBoardStage {
  id: string;
  text: string;
  done: boolean;
  parentId: string | null;
  priority: "low" | "normal" | "high";
}

export interface MissionBoardItem extends Mission {
  total: number;
  done: number;
  percent: number;
  idleDays: number;
  blocked: number;
  next: { id: string; text: string; reason: string } | null;
  stages: MissionBoardStage[];
}

export interface MissionServiceOptions {
  getMissions(): Mission[];
  getNotes(): Note[];
  save(): Promise<void>;
  now(): number;
  addNote(kind: "todo", body: unknown): Promise<Note>;
  updateTask(id: string, patch: Record<string, unknown>): Promise<Note>;
}

/**
 * Mission metadata and read-only mission progress.
 *
 * To-dos remain the canonical stage/progress source. The service never duplicates task state.
 */
export class MissionService {
  constructor(private readonly options: MissionServiceOptions) {}

  list(): Mission[] {
    return this.options.getMissions().map((mission) => ({ ...mission }));
  }

  board(now = this.options.now()): MissionBoardItem[] {
    const notes = this.options.getNotes();

    return this.options.getMissions().map((mission) => {
      const tasks = notes.filter((note) => note.kind === "todo" && note.project === mission.id);
      const done = tasks.filter((note) => note.done).length;
      const open = tasks.filter((note) => !note.done);
      const blocked = open.filter(
        (note) => note.parentId && notes.some((parent) => parent.id === note.parentId && !parent.done),
      );
      const blockedIds = new Set(blocked.map((note) => note.id));
      const available = open.filter((note) => !blockedIds.has(note.id));
      const priority = (note: Note) =>
        note.priority === "high" ? 2 : note.priority === "normal" ? 1 : 0;

      available.sort(
        (a, b) =>
          priority(b) - priority(a) ||
          (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"),
      );

      const next = available[0];
      return {
        ...mission,
        total: tasks.length,
        done,
        percent: tasks.length ? Math.round(done * 100 / tasks.length) : 0,
        idleDays: this.idleDays(mission, now),
        blocked: blocked.length,
        next: next
          ? {
            id: next.id,
            text: next.text,
            reason: next.dueAt ? "Ближайший срок и приоритет" : "Доступный этап",
          }
          : null,
        stages: tasks.map((task) => ({
          id: task.id,
          text: task.text,
          done: task.done,
          parentId: task.parentId ?? null,
          priority: task.priority ?? "normal",
        })),
      };
    });
  }

  /** Whole days since the mission or any of its stages last changed materially. */
  idleDays(mission: Mission, now = this.options.now()): number {
    let last = Date.parse(mission.createdAt);

    for (const note of this.options.getNotes()) {
      if (note.kind !== "todo" || note.project !== mission.id) continue;
      last = Math.max(
        last,
        Date.parse(note.createdAt),
        note.completedAt ? Date.parse(note.completedAt) : 0,
      );
    }

    return Number.isFinite(last)
      ? Math.max(0, Math.floor((now - last) / 86_400_000))
      : 0;
  }

  async add(title: unknown, description: unknown = ""): Promise<Mission> {
    const name = text(title, "Название миссии");
    const missions = this.options.getMissions();

    if (missions.length >= MAX_MISSIONS) throw bad("Достигнут лимит миссий", 409);
    if (missions.some((mission) => mission.title.toLowerCase() === name.toLowerCase())) {
      throw bad("Миссия с таким названием уже существует", 409);
    }
    if (typeof description !== "string" || description.length > 1000) {
      throw bad("Описание до 1000 символов");
    }

    const mission: Mission = {
      id: randomUUID(),
      title: name,
      description: description.trim(),
      createdAt: new Date(this.options.now()).toISOString(),
      status: "active",
    };
    missions.push(mission);
    await this.options.save();
    return { ...mission };
  }

  async updateStatus(id: string, status: unknown): Promise<Mission> {
    const mission = this.options.getMissions().find((item) => item.id === id);
    if (!mission) throw bad("Миссия не найдена", 404);
    if (!["active", "paused", "complete"].includes(String(status))) {
      throw bad("Некорректный статус");
    }

    mission.status = status as Mission["status"];
    await this.options.save();
    return { ...mission };
  }

  async addStage(id: string, description: unknown): Promise<Note> {
    const mission = this.options.getMissions().find((item) => item.id === id);
    if (!mission) throw bad("Миссия не найдена", 404);
    if (mission.status !== "active") throw bad("Миссия приостановлена", 409);

    const stage = await this.options.addNote("todo", description);
    return this.options.updateTask(stage.id, { project: id });
  }
}
