import type { Automation, Note } from "./organizer";
import type { MissionBoardItem } from "./mission-service";

const minsOf = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
};

const minsNow = (time: number): number => {
  const d = new Date(time);
  return d.getHours() * 60 + d.getMinutes();
};

const dayStart = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const dayEnd = (time: number): number => dayStart(time) + 86_400_000;

export type SmartPriorityMode = "work" | "personal" | "mixed";

export interface SmartPriorityItem {
  id: string;
  text: string;
  score: number;
  primaryReason: string;
  reasons: string[];
  estimateMinutes: number;
  area: "work" | "personal";
  dueAt?: string;
  project?: string;
  missionTitle?: string;
  status?: "doing";
}

export interface SmartPriorityResult {
  generatedAt: string;
  mode: SmartPriorityMode;
  considered: number;
  eligible: number;
  excluded: {
    waiting: number;
    blocked: number;
    inactiveMission: number;
    scheduledLater: number;
  };
  recommended: SmartPriorityItem[];
  advisoryOnly: true;
}

export interface SmartPriorityServiceOptions {
  getNotes(): readonly Note[];
  getAutomation(): Automation;
  getMissions(): MissionBoardItem[];
  isWork(note: Note): boolean;
  workDayFor(date: Date): boolean;
  now(): number;
}

interface Factor {
  weight: number;
  label: string;
}

/**
 * Deterministic "what should I do now?" ranking.
 *
 * It is intentionally read-only and explainable: every score is composed only from local task,
 * calendar/work-context and mission facts. No model call can silently change the ordering.
 */
export class SmartPriorityService {
  constructor(private readonly options: SmartPriorityServiceOptions) {}

  rank(limit = 5, now = this.options.now()): SmartPriorityResult {
    const max = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 5;
    const notes = this.options.getNotes();
    const open = notes.filter((note) => note.kind === "todo" && !note.done);
    const missions = this.options.getMissions();
    const missionById = new Map(missions.map((mission) => [mission.id, mission]));
    const automation = this.options.getAutomation();
    const currentMinutes = minsNow(now);
    const workWindow =
      automation.workFirst &&
      this.options.workDayFor(new Date(now)) &&
      currentMinutes >= minsOf(automation.workFrom) &&
      currentMinutes < minsOf(automation.workTo);
    const mode: SmartPriorityMode = automation.workFirst
      ? workWindow ? "work" : "personal"
      : "mixed";

    const excluded = {
      waiting: 0,
      blocked: 0,
      inactiveMission: 0,
      scheduledLater: 0,
    };

    const ranked: Array<SmartPriorityItem & { dueSort: number; createdAt: string }> = [];

    for (const note of open) {
      if (note.status === "waiting") {
        excluded.waiting++;
        continue;
      }

      if (
        note.parentId &&
        notes.some((parent) => parent.id === note.parentId && parent.kind === "todo" && !parent.done)
      ) {
        excluded.blocked++;
        continue;
      }

      const mission = note.project ? missionById.get(note.project) : undefined;
      if (mission && mission.status !== "active") {
        excluded.inactiveMission++;
        continue;
      }

      const due = note.dueAt ? Date.parse(note.dueAt) : Infinity;
      if (note.meeting && Number.isFinite(due) && due > now + 45 * 60_000) {
        excluded.scheduledLater++;
        continue;
      }

      const factors: Factor[] = [];
      const add = (weight: number, label: string) => factors.push({ weight, label });

      if (Number.isFinite(due)) {
        if (due < now) add(90, "Просрочено");
        else if (due < dayEnd(now)) add(55, "Срок сегодня");
        else if (due <= now + 36 * 60 * 60_000) add(35, "Срок скоро");
        else if (due <= now + 3 * 86_400_000) add(20, "Срок в ближайшие 3 дня");
      }

      if (note.priority === "high") add(30, "Высокий приоритет");
      else if (note.priority !== "low") add(10, "Обычный приоритет");
      else add(-10, "Низкий приоритет");

      if (note.status === "doing") add(25, "Уже в работе");

      if (note.rolled) {
        add(Math.min(24, note.rolled * 8), `Переносилось ${note.rolled} раз`);
      }

      const estimateMinutes = note.estimateMinutes ?? 30;
      if (estimateMinutes <= 15) add(12, "Можно закрыть за 15 минут");
      else if (estimateMinutes <= 30) add(8, "Короткое дело");
      else if (estimateMinutes <= 60) add(4, "Укладывается примерно в час");
      else if (estimateMinutes > 180) add(-8, "Потребует больше 3 часов");

      const isWork = this.options.isWork(note);
      if (mode === "work") {
        add(isWork ? 14 : -4, isWork ? "Подходит для рабочего времени" : "Личное дело в рабочее время");
      } else if (mode === "personal") {
        add(isWork ? -4 : 10, isWork ? "Рабочее дело вне рабочего времени" : "Подходит для личного времени");
      }

      if (mission) {
        if (mission.next?.id === note.id) {
          add(18, `Следующий шаг цели «${mission.title}»`);
        } else {
          add(6, `Двигает цель «${mission.title}»`);
        }
        if (mission.idleDays >= 3) {
          add(Math.min(12, mission.idleDays * 2), `Цель стоит ${mission.idleDays} дней`);
        }
      }

      if (note.meeting && Number.isFinite(due)) {
        add(40, due <= now ? "Встреча уже должна была начаться" : "Встреча скоро");
      }

      const score = factors.reduce((sum, factor) => sum + factor.weight, 0);
      const orderedFactors = [...factors].sort((a, b) => b.weight - a.weight);
      const positive = orderedFactors.filter((factor) => factor.weight > 0);
      const reasons = [
        ...positive.slice(0, 3),
        ...orderedFactors.filter((factor) => factor.weight <= 0).slice(0, 1),
      ].map((factor) => factor.label);
      const primaryReason = positive[0]?.label ?? orderedFactors[0]?.label ?? "Доступное дело";

      ranked.push({
        id: note.id,
        text: note.text,
        score,
        primaryReason,
        reasons,
        estimateMinutes,
        area: isWork ? "work" : "personal",
        ...(note.dueAt ? { dueAt: note.dueAt } : {}),
        ...(note.project ? { project: note.project } : {}),
        ...(mission ? { missionTitle: mission.title } : {}),
        ...(note.status === "doing" ? { status: "doing" as const } : {}),
        dueSort: due,
        createdAt: note.createdAt,
      });
    }

    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        a.dueSort - b.dueSort ||
        a.createdAt.localeCompare(b.createdAt),
    );

    return {
      generatedAt: new Date(now).toISOString(),
      mode,
      considered: open.length,
      eligible: ranked.length,
      excluded,
      recommended: ranked.slice(0, max).map(({ dueSort: _dueSort, createdAt: _createdAt, ...item }) => item),
      advisoryOnly: true,
    };
  }
}
