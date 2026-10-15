import { describe, expect, it, vi } from "vitest";
import type { FileLink, Note } from "./organizer";
import { WorkspaceService, areaOf } from "./workspace-service";

function make() {
  let projects: ReturnType<WorkspaceService["listProjects"]> = [];
  let templates: ReturnType<WorkspaceService["listTemplates"]> = [];
  let daysOff: ReturnType<WorkspaceService["listDaysOff"]> = [];
  const notes: Note[] = [];
  const save = vi.fn(async () => {});
  const service = new WorkspaceService({
    getProjects: () => projects,
    replaceProjects: (value) => { projects = value; },
    getTemplates: () => templates,
    replaceTemplates: (value) => { templates = value; },
    getDaysOff: () => daysOff,
    replaceDaysOff: (value) => { daysOff = value; },
    getNotes: () => notes,
    save,
    workday: (date) => date.getDay() !== 0 && date.getDay() !== 6,
    cleanLinks: (value) => {
      if (!Array.isArray(value)) return undefined;
      const out = value
        .filter((item): item is FileLink =>
          !!item &&
          typeof item.id === "string" &&
          typeof item.name === "string"
        )
        .map((item) => ({ id: item.id, name: item.name.trim() }));
      return out.length ? out : undefined;
    },
  });
  return {
    service,
    notes,
    save,
    get projects() { return projects; },
    get templates() { return templates; },
    get daysOff() { return daysOff; },
  };
}

const todo = (id: string, text: string, patch: Partial<Note> = {}): Note => ({
  id,
  kind: "todo",
  text,
  done: false,
  createdAt: "2026-10-12T09:00:00Z",
  ...patch,
});

describe("WorkspaceService", () => {
  it("resolves work/personal from explicit area, project metadata and conventional project names", () => {
    expect(areaOf({ project: "работа" })).toBe("work");
    expect(areaOf({ project: "дом" })).toBe("personal");
    expect(areaOf({ project: "Cloud.ru" }, [{ name: "cloud.ru", area: "work" }])).toBe("work");
    expect(areaOf({ project: "работа", area: "personal" })).toBe("personal");
  });

  it("stores project metadata case-insensitively and forgets empty projects", async () => {
    const x = make();
    await x.service.setProject("Cloud.ru", {
      color: "blue",
      dueAt: "2026-12-01",
      area: "work",
      files: [{ id: "f1", name: " plan.pdf " }],
    });
    expect(x.service.listProjects()).toEqual([{
      name: "Cloud.ru",
      color: "blue",
      dueAt: "2026-12-01",
      area: "work",
      files: [{ id: "f1", name: "plan.pdf" }],
    }]);

    await x.service.setProject("cloud.ru", {
      color: null,
      dueAt: null,
      area: null,
      files: null,
    });
    expect(x.service.listProjects()).toEqual([]);
  });

  it("keeps quick templates distinct case-insensitively", async () => {
    const x = make();
    const template = await x.service.addTemplate("отчёт по пятницам");
    await expect(x.service.addTemplate("Отчёт по пятницам")).rejects.toMatchObject({ status: 409 });
    expect(x.service.listTemplates()).toEqual([template]);

    await x.service.removeTemplate(template.id);
    expect(x.service.listTemplates()).toEqual([]);
  });

  it("tracks vacation/sick ranges and reports colliding work tasks", async () => {
    const x = make();
    await x.service.setProject("Office", { area: "work" });
    x.notes.push(
      todo("work", "Отчёт", { project: "Office", dueAt: "2026-10-14T11:00:00Z" }),
      todo("home", "Хлеб", { dueAt: "2026-10-14T11:00:00Z" }),
    );

    const result = await x.service.addDayOff("2026-10-13", "2026-10-16", "vacation");
    expect(result.clash).toEqual(["work"]);
    expect(x.service.awayOn("2026-10-15")).toMatchObject({ kind: "vacation" });
    await expect(x.service.addDayOff("2026-10-15", "2026-10-20", "sick")).rejects.toMatchObject({ status: 409 });
  });

  it("workDayFor combines weekday policy with days away", async () => {
    const x = make();
    await x.service.addDayOff("2026-10-13", "2026-10-14", "sick");
    expect(x.service.workDayFor(new Date("2026-10-13T12:00:00"))).toBe(false);
    expect(x.service.workDayFor(new Date("2026-10-15T12:00:00"))).toBe(true);
    expect(x.service.workDayFor(new Date("2026-10-17T12:00:00"))).toBe(false);
  });
});
