import { randomUUID } from "node:crypto";
import type { FileLink, Note } from "./organizer";

export type Area = "work" | "personal";
export interface ProjectMeta {
  name: string;
  color?: string;
  dueAt?: string;
  area?: Area;
  files?: FileLink[];
}
export interface TaskTemplate { id: string; text: string }
export interface DayOff { id: string; from: string; to: string; kind: "vacation" | "sick" }

export const PROJECT_COLORS = ["gold", "blue", "green", "violet", "red", "teal", "orange", "gray"];
export const MAX_PROJECTS = 100;
export const MAX_TEMPLATES = 30;
export const MAX_DAYS_OFF = 50;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_TEXT = 500;
const YEAR = 366 * 86_400_000;

const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_TEXT) {
    throw bad(`${label}: от 1 до ${MAX_TEXT} символов`);
  }
  return value.trim();
};

const localKey = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A to-do's sphere: its own, else its project's, else work for a project named работа/work. */
export function areaOf(
  note: Pick<Note, "area" | "project">,
  projects: ProjectMeta[] = [],
): Area {
  if (note.area) return note.area;
  if (!note.project) return "personal";
  const project = projects.find((item) => item.name.toLowerCase() === note.project!.toLowerCase());
  if (project?.area) return project.area;
  return /^(работа|work|рабочее)$/i.test(note.project) ? "work" : "personal";
}

export interface WorkspaceServiceOptions {
  getProjects(): ProjectMeta[];
  replaceProjects(projects: ProjectMeta[]): void;
  getTemplates(): TaskTemplate[];
  replaceTemplates(templates: TaskTemplate[]): void;
  getDaysOff(): DayOff[];
  replaceDaysOff(daysOff: DayOff[]): void;
  getNotes(): readonly Note[];
  save(): Promise<void>;
  workday(date: Date): boolean;
  cleanLinks(value: unknown): FileLink[] | undefined;
}

/**
 * Project metadata, quick-entry templates and days away from work.
 * Task mutation and planning stay in their dedicated services.
 */
export class WorkspaceService {
  constructor(private readonly options: WorkspaceServiceOptions) {}

  listProjects(): ProjectMeta[] {
    return this.options.getProjects().map((project) => ({
      ...project,
      ...(project.files ? { files: project.files.map((file) => ({ ...file })) } : {}),
    }));
  }

  /** Colour, deadline, area and files; a project with no metadata is forgotten. */
  async setProject(name: unknown, patch: Record<string, unknown>): Promise<ProjectMeta> {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      throw bad("Название проекта: от 1 до 80 символов");
    }

    const key = name.trim();
    const projects = this.options.getProjects();
    const current = projects.find((project) => project.name.toLowerCase() === key.toLowerCase()) ?? { name: key };
    const next: ProjectMeta = {
      ...current,
      ...(current.files ? { files: current.files.map((file) => ({ ...file })) } : {}),
    };

    if ("color" in patch) {
      if (patch.color === null || patch.color === "") delete next.color;
      else if (typeof patch.color === "string" && PROJECT_COLORS.includes(patch.color)) next.color = patch.color;
      else throw bad("Цвет: " + PROJECT_COLORS.join(", "));
    }

    if ("dueAt" in patch) {
      if (patch.dueAt === null || patch.dueAt === "") delete next.dueAt;
      else if (typeof patch.dueAt === "string" && DAY_RE.test(patch.dueAt)) next.dueAt = patch.dueAt;
      else throw bad("Срок проекта: YYYY-MM-DD");
    }

    if ("area" in patch) {
      if (patch.area === null || patch.area === "") delete next.area;
      else if (patch.area === "work" || patch.area === "personal") next.area = patch.area;
      else throw bad("Сфера: work или personal");
    }

    if ("files" in patch) {
      if (patch.files !== null && !Array.isArray(patch.files)) throw bad("Файлы: список");
      const files = this.options.cleanLinks(patch.files);
      if (files) next.files = files;
      else delete next.files;
    }

    const remaining = projects.filter((project) => project !== current);
    if (next.color || next.dueAt || next.area || next.files) {
      if (remaining.length >= MAX_PROJECTS) {
        throw bad(`Достигнут предел: ${MAX_PROJECTS} проектов`, 409);
      }
      remaining.push(next);
    }

    this.options.replaceProjects(remaining);
    await this.options.save();
    return {
      ...next,
      ...(next.files ? { files: next.files.map((file) => ({ ...file })) } : {}),
    };
  }

  listTemplates(): TaskTemplate[] {
    return this.options.getTemplates().map((template) => ({ ...template }));
  }

  async addTemplate(body: unknown): Promise<TaskTemplate> {
    const value = text(body, "Шаблон");
    const templates = this.options.getTemplates();

    if (templates.some((template) => template.text.toLowerCase() === value.toLowerCase())) {
      throw bad("Такой шаблон уже есть", 409);
    }
    if (templates.length >= MAX_TEMPLATES) {
      throw bad(`Достигнут предел: ${MAX_TEMPLATES} шаблонов`, 409);
    }

    const template: TaskTemplate = { id: randomUUID(), text: value };
    templates.push(template);
    await this.options.save();
    return { ...template };
  }

  async removeTemplate(id: string): Promise<void> {
    const templates = this.options.getTemplates();
    if (!templates.some((template) => template.id === id)) throw bad("Шаблон не найден", 404);
    this.options.replaceTemplates(templates.filter((template) => template.id !== id));
    await this.options.save();
  }

  listDaysOff(): DayOff[] {
    return this.options.getDaysOff()
      .map((dayOff) => ({ ...dayOff }))
      .sort((a, b) => a.from.localeCompare(b.from));
  }

  /**
   * Vacation or sick leave, inclusive. Returns open work to-dos whose due date falls inside it.
   */
  async addDayOff(
    from: unknown,
    to: unknown,
    kind: unknown,
  ): Promise<{ dayOff: DayOff; clash: string[] }> {
    if (
      typeof from !== "string" ||
      !DAY_RE.test(from) ||
      typeof to !== "string" ||
      !DAY_RE.test(to) ||
      !Number.isFinite(Date.parse(from + "T12:00")) ||
      !Number.isFinite(Date.parse(to + "T12:00"))
    ) throw bad("Даты: YYYY-MM-DD");

    if (to < from) throw bad("Конец раньше начала");
    if (Date.parse(to + "T12:00") - Date.parse(from + "T12:00") > YEAR) {
      throw bad("Не длиннее года");
    }
    if (kind !== "vacation" && kind !== "sick") throw bad("Вид: vacation или sick");

    let daysOff = this.options.getDaysOff();
    if (daysOff.some((dayOff) => dayOff.from <= to && from <= dayOff.to)) {
      throw bad("Эти дни уже отмечены", 409);
    }
    if (daysOff.length >= MAX_DAYS_OFF) daysOff = daysOff.slice(1);

    const dayOff: DayOff = { id: randomUUID(), from, to, kind };
    daysOff.push(dayOff);
    this.options.replaceDaysOff(daysOff);
    await this.options.save();

    const projects = this.options.getProjects();
    const clash = this.options.getNotes()
      .filter((note) =>
        note.kind === "todo" &&
        !note.done &&
        note.dueAt &&
        areaOf(note, projects) === "work" &&
        localKey(Date.parse(note.dueAt)) >= from &&
        localKey(Date.parse(note.dueAt)) <= to
      )
      .map((note) => note.id);

    return { dayOff: { ...dayOff }, clash };
  }

  async removeDayOff(id: string): Promise<void> {
    const daysOff = this.options.getDaysOff();
    if (!daysOff.some((dayOff) => dayOff.id === id)) throw bad("Не найдено", 404);
    this.options.replaceDaysOff(daysOff.filter((dayOff) => dayOff.id !== id));
    await this.options.save();
  }

  awayOn(key: string): DayOff | undefined {
    const found = this.options.getDaysOff().find((dayOff) => dayOff.from <= key && key <= dayOff.to);
    return found ? { ...found } : undefined;
  }

  isWork(note: Pick<Note, "area" | "project">): boolean {
    return areaOf(note, this.options.getProjects()) === "work";
  }

  /** Production/workday policy plus explicit vacation/sick leave. */
  workDayFor(date: Date): boolean {
    return this.options.workday(date) && !this.awayOn(localKey(date.getTime()));
  }
}
