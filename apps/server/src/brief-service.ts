import { randomUUID } from "node:crypto";
import { nextHoliday, prodDay } from "@juunibi/core";
import type { AutoLogEntry, AutoNote, Automation, DayOff, Note, Reminder } from "./organizer";
import type { AutomationState } from "./automation-engine";
import type { PlanningDayKind } from "./planning-service";

const MAX_TEXT = 500;
const MAX_AUTO_TEXT = 1500;

const localKey = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dayStart = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const hhmm = (time: number): string =>
  new Date(time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

const dateOnly = (iso: string): boolean => {
  const d = new Date(iso);
  return d.getHours() === 23 && d.getMinutes() === 59;
};

const minsOf = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
};

const minsNow = (time: number): number => {
  const d = new Date(time);
  return d.getHours() * 60 + d.getMinutes();
};

const weekday = (d: Date): boolean => d.getDay() !== 0 && d.getDay() !== 6;
const hoursText = (minutes: number): string =>
  (Math.round(minutes / 6) / 10).toLocaleString("ru-RU") + " ч";
const dayWord = (n: number): string =>
  n % 10 === 1 && n % 100 !== 11
    ? "день"
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? "дня"
      : "дней";
const timesWord = (n: number): string =>
  n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "раза" : "раз";

export interface BriefMission {
  status: "active" | "paused" | "complete";
  title: string;
  percent: number;
  idleDays: number;
  next: { id: string; text: string; reason: string } | null;
  stages: { id: string }[];
}

export interface BriefServiceOptions {
  getNotes(): Note[];
  replaceNotes(notes: Note[]): void;
  getReminders(): Reminder[];
  getAutomation(): Automation;
  getAutoState(): AutomationState;
  now(): number;
  awayOn(day: string): DayOff | undefined;
  isWork(note: Note): boolean;
  dayLoad(day: string, now?: number): { planned: number; capacity: number; over: boolean };
  missionBoard(): BriefMission[];
  addLog(kind: AutoLogEntry["kind"], text: string, undo?: AutoLogEntry["undo"]): void;
  pruneReminders(): void;
  save(): Promise<void>;
  getComposer(): ((facts: string) => Promise<string | null>) | undefined;
}

/**
 * Morning/evening/weekly reporting for Organizer.
 * Facts stay deterministic; the optional model can only rephrase the morning facts.
 */
export class BriefService {
  private composing = false;

  constructor(private readonly options: BriefServiceOptions) {}

  shouldRunBrief(now: number): boolean {
    if (this.composing || this.options.getAutoState().briefDay === localKey(now)) return false;
    const briefAt = minsOf(this.options.getAutomation().briefTime);
    const current = minsNow(now);
    return current >= briefAt && current < Math.max(15 * 60, briefAt + 60);
  }

  shouldRunEvening(now: number): boolean {
    return !this.composing &&
      this.options.getAutoState().eveningDay !== localKey(now) &&
      minsNow(now) >= minsOf(this.options.getAutomation().eveningTime);
  }

  shouldRunWeek(now: number): boolean {
    return !this.composing &&
      new Date(now).getDay() === 0 &&
      this.options.getAutoState().weekDay !== localKey(now) &&
      minsNow(now) >= minsOf(this.options.getAutomation().eveningTime);
  }

  dayKind(key: string): PlanningDayKind {
    const off = this.options.awayOn(key);
    if (off) {
      return {
        work: false,
        short: false,
        label: (off.kind === "sick" ? "больничный" : "отпуск") +
          " до " +
          new Date(off.to + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
        away: off,
      };
    }

    const pd = prodDay(key);
    const work = pd ? pd.kind === "work" || pd.kind === "short" : weekday(new Date(key + "T12:00"));
    const label = pd
      ? pd.kind === "holiday"
        ? "праздник"
        : pd.kind === "off"
          ? "выходной (перенос)"
          : pd.kind === "weekend"
            ? "выходной"
            : pd.kind === "short"
              ? "сокращённый рабочий день"
              : "рабочий день"
      : work
        ? "рабочий день"
        : "выходной";

    return {
      work,
      short: pd?.kind === "short",
      label,
      ...(pd?.note ? { note: pd.note } : {}),
    };
  }

  briefFacts(now = this.options.now()): { text: string; short: string } {
    const automation = this.options.getAutomation();
    const today = localKey(now);
    const start = dayStart(now);
    const end = start + 86_400_000;
    const dayKind = this.dayKind(today);
    const kind = dayKind.label +
      (dayKind.note && dayKind.label === "праздник" ? ` (${dayKind.note})` : "");
    const dayName = new Date(now).toLocaleDateString("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const open = this.options.getNotes().filter((note) => note.kind === "todo" && !note.done);
    const todays = open
      .filter((note) => note.dueAt && Date.parse(note.dueAt) >= start && Date.parse(note.dueAt) < end)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
    const overdue = open.filter((note) => note.dueAt && Date.parse(note.dueAt) < start);
    const reminders = this.options.getReminders()
      .filter((reminder) =>
        reminder.status === "scheduled" &&
        !reminder.rule &&
        Date.parse(reminder.at) >= now &&
        Date.parse(reminder.at) < end
      )
      .sort((a, b) => a.at.localeCompare(b.at));
    const rolled = open.filter((note) =>
      note.rolled && note.dueAt && Date.parse(note.dueAt) >= start && Date.parse(note.dueAt) < end
    ).length;
    const important = open.filter((note) => note.priority === "high" && !todays.includes(note)).slice(0, 2);
    const item = (note: Note) =>
      (note.dueAt && !dateOnly(note.dueAt) ? hhmm(Date.parse(note.dueAt)) + " " : "") + note.text;

    const lines = [dayName[0]!.toUpperCase() + dayName.slice(1) + " — " + kind + "."];
    const work = dayKind.work ? todays.filter((note) => this.options.isWork(note)) : [];
    const waiting = dayKind.work
      ? open.filter((note) => note.status === "waiting" && this.options.isWork(note))
      : [];

    if (work.length || waiting.length) {
      const meetings = work.filter((note) => note.meeting && !dateOnly(note.dueAt!));
      const due = work.filter((note) => !meetings.includes(note));
      const span = (note: Note) =>
        hhmm(Date.parse(note.dueAt!)) +
        (note.estimateMinutes
          ? "–" + hhmm(Date.parse(note.dueAt!) + note.estimateMinutes * 60_000)
          : "");
      const parts = [
        meetings.length
          ? "встречи: " + meetings.slice(0, 4).map((note) => span(note) + " " + note.text).join("; ")
          : "",
        due.length ? "сроки: " + due.slice(0, 4).map(item).join("; ") : "",
        waiting.length
          ? `жду ответа: ${waiting.length} (` +
            waiting.slice(0, 2).map((note) =>
              (note.waitingFor ? note.waitingFor + " — " : "") + note.text
            ).join("; ") +
            ")"
          : "",
      ].filter(Boolean);
      lines.push("Работа: " + parts.join("; ") + ".");
    }

    const rest = work.length ? todays.filter((note) => !work.includes(note)) : todays;
    if (!work.length || rest.length) {
      lines.push(
        rest.length
          ? `${work.length ? "Личные дела" : "Дела"} на сегодня (${rest.length}): ` +
            rest.slice(0, 5).map(item).join("; ") +
            (rest.length > 5 ? "…" : ".")
          : dayKind.work
            ? "На сегодня дел со сроком нет."
            : "Дел на сегодня нет.",
      );
    }

    if (rolled) lines.push(`Из них перенесено со вчера: ${rolled}.`);
    if (overdue.length) {
      lines.push(
        dayKind.work
          ? `Просрочено: ${overdue.length} (${overdue.slice(0, 3).map((note) => note.text).join("; ")}).`
          : `Просрочено: ${overdue.length}.`,
      );
    }
    if (reminders.length) {
      lines.push(
        "Напоминания: " +
        reminders.slice(0, 4).map((reminder) => hhmm(Date.parse(reminder.at)) + " " + reminder.text).join("; ") +
        ".",
      );
    }

    if (dayKind.work) {
      if (important.length) lines.push("Важное без срока на сегодня: " + important.map((note) => note.text).join("; ") + ".");
      const load = this.options.dayLoad(today, now);
      if (load.over) {
        lines.push(
          `День перегружен: дел примерно на ${hoursText(load.planned)} при ${hoursText(load.capacity)} свободных.`,
        );
      }
    }

    if (automation.stuckAfter) {
      const stuck = open.filter((note) => (note.rolled ?? 0) >= automation.stuckAfter).slice(0, 2);
      if (stuck.length) {
        lines.push(
          "Застряло: " +
          stuck.map((note) => `«${note.text}» (перенесено ${note.rolled} ${timesWord(note.rolled!)})`).join("; ") +
          ". Может, разбить на шаги или убрать?",
        );
      }
    }

    if (automation.streaks) {
      const streaks = todays.filter((note) => note.repeat && (note.streak ?? 0) >= 3).slice(0, 2);
      if (streaks.length) {
        lines.push("Серии: " + streaks.map((note) => `«${note.text}» ${note.streak} подряд`).join("; ") + ", не прервите.");
      }
    }

    if (automation.goalNudge && dayKind.work) {
      const goals = this.options.missionBoard()
        .filter((mission) =>
          mission.status === "active" &&
          mission.idleDays >= automation.goalNudge &&
          mission.next
        )
        .slice(0, 1);
      for (const mission of goals) {
        lines.push(
          `Цель «${mission.title}» стоит ${mission.idleDays} ${dayWord(mission.idleDays)}. Следующий шаг: ${mission.next!.text}.`,
        );
      }
    }

    if (automation.holidayWarn) {
      const warning = this.tomorrowWarning(now);
      if (warning) lines.push(warning);
    }
    if (!dayKind.work) lines.push(...this.dayOffAhead(now));

    const text = lines.join("\n").slice(0, MAX_AUTO_TEXT);
    const short =
      `Сегодня ${todays.length ? "дел: " + todays.length : "дел со сроком нет"}` +
      (overdue.length ? `, просрочено: ${overdue.length}` : "") +
      (reminders.length ? `, напоминаний: ${reminders.length}` : "") +
      ` · ${kind}`;
    return { text, short };
  }

  tomorrowWarning(now = this.options.now()): string | null {
    const end = dayStart(now) + 86_400_000;
    const key = localKey(end + 3_600_000);
    const pd = prodDay(key);
    if (!pd || (pd.kind !== "holiday" && pd.kind !== "off" && pd.kind !== "short")) return null;

    const due = this.options.getNotes().filter((note) =>
      note.kind === "todo" &&
      !note.done &&
      note.dueAt &&
      localKey(Date.parse(note.dueAt)) === key
    ).length;

    if (pd.kind === "short") {
      return "Завтра сокращённый рабочий день, на час короче." +
        (due ? ` На него назначено дел: ${due}.` : "");
    }

    return `Завтра ${pd.kind === "holiday"
      ? "праздник" + (pd.note ? ` (${pd.note})` : "")
      : "выходной (перенос)"}.` +
      (due ? ` На него назначено дел: ${due}, их можно сдвинуть на рабочий день.` : "");
  }

  eveningFacts(now = this.options.now()): { text: string; short: string; left: number } {
    const start = dayStart(now);
    const end = start + 86_400_000;
    const tomorrowKey = localKey(end + 3_600_000);
    const notes = this.options.getNotes();

    const done = notes.filter((note) =>
      note.kind === "todo" &&
      note.done &&
      note.completedAt &&
      Date.parse(note.completedAt) >= start &&
      Date.parse(note.completedAt) < end
    );
    const left = notes.filter((note) =>
      note.kind === "todo" &&
      !note.done &&
      note.dueAt &&
      Date.parse(note.dueAt) < end
    );
    const tomorrow = notes.filter((note) =>
      note.kind === "todo" &&
      !note.done &&
      note.dueAt &&
      localKey(Date.parse(note.dueAt)) === tomorrowKey
    ).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
    const reminders = this.options.getReminders().filter((reminder) =>
      reminder.status === "scheduled" &&
      !reminder.rule &&
      localKey(Date.parse(reminder.at)) === tomorrowKey
    );

    const dayName = new Date(now).toLocaleDateString("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const list = (items: Note[]) =>
      items.slice(0, 4).map((note) => note.text).join("; ") + (items.length > 4 ? "…" : "");
    const stop = (value: string) => value.endsWith("…") ? value : value + ".";

    const lines = [`Итог дня: ${dayName}.`];
    lines.push(
      done.length
        ? stop(`Сделано: ${done.length} — ${list(done)}`)
        : "Сегодня ничего не отмечено сделанным.",
    );
    if (left.length) {
      lines.push(stop(`Не успели: ${left.length} — ${list(left)}`) + " Их можно перенести на завтра одной кнопкой.");
    } else if (done.length) {
      lines.push("Всё, что было на сегодня, сделано. Отличный день!");
    }

    const tomorrowKind = this.dayKind(tomorrowKey);
    lines.push(
      stop(
        `Завтра ${tomorrowKind.label}: ` +
        (tomorrow.length ? `дел ${tomorrow.length} — ${list(tomorrow)}` : "дел со сроком пока нет") +
        (reminders.length ? `, напоминаний: ${reminders.length}` : ""),
      ),
    );

    if (this.options.getAutomation().holidayWarn) {
      const warning = this.tomorrowWarning(now);
      if (
        warning &&
        !warning.startsWith("Завтра праздник") &&
        !warning.startsWith("Завтра выходной")
      ) lines.push(warning);
    }

    const short =
      `Сделано: ${done.length}` +
      (left.length ? `, не успели: ${left.length}` : "") +
      `. Завтра дел: ${tomorrow.length}`;
    return { text: lines.join("\n"), short, left: left.length };
  }

  weekFacts(now = this.options.now()): { text: string; short: string } {
    const end = dayStart(now) + 86_400_000;
    const start = end - 7 * 86_400_000;
    const todos = this.options.getNotes().filter((note) => note.kind === "todo");
    const done = todos.filter((note) =>
      note.done &&
      note.completedAt &&
      Date.parse(note.completedAt) >= start &&
      Date.parse(note.completedAt) < end
    );

    const byDay = new Map<string, number>();
    for (const note of done) {
      const key = new Date(note.completedAt!).toLocaleDateString("ru-RU", { weekday: "long" });
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const best = [...byDay].sort((a, b) => b[1] - a[1])[0];
    const open = todos.filter((note) => !note.done);
    const automation = this.options.getAutomation();
    const stuck = open.filter((note) => (note.rolled ?? 0) >= Math.max(2, automation.stuckAfter || 3));
    const overdue = open.filter((note) => note.dueAt && Date.parse(note.dueAt) < end - 86_400_000);
    const next = open.filter((note) =>
      note.dueAt &&
      Date.parse(note.dueAt) >= end &&
      Date.parse(note.dueAt) < end + 7 * 86_400_000
    );

    const nextBy = new Map<string, number>();
    for (const note of next) {
      const key = new Date(note.dueAt!).toLocaleDateString("ru-RU", { weekday: "long" });
      nextBy.set(key, (nextBy.get(key) ?? 0) + 1);
    }
    const busiest = [...nextBy].sort((a, b) => b[1] - a[1])[0];
    const goals = this.options.missionBoard().filter((mission) => mission.status === "active");
    const from = new Date(start).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const to = new Date(end - 1).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const lines = [`Обзор недели: ${from} — ${to}.`];

    lines.push(
      done.length
        ? `Сделано дел: ${done.length}` +
          (best && best[1] > 1 ? `, больше всего — ${best[0]} (${best[1]})` : "") +
          "."
        : "За неделю ничего не отмечено сделанным.",
    );
    if (stuck.length) {
      lines.push(
        `Застряло: ${stuck.slice(0, 3).map((note) => `«${note.text}»`).join(", ")}. Стоит разбить на шаги или убрать.`,
      );
    }
    if (overdue.length) lines.push(`Просрочено: ${overdue.length}.`);

    for (const mission of goals.slice(0, 3)) {
      const moved = mission.stages.filter((stage) => {
        const note = this.options.getNotes().find((item) => item.id === stage.id);
        return note?.completedAt && Date.parse(note.completedAt) >= start;
      }).length;
      lines.push(
        `Цель «${mission.title}»: ${mission.percent}%` +
        (moved ? `, за неделю шагов: ${moved}` : ", за неделю не двигалась") +
        ".",
      );
    }

    if (automation.streaks) {
      const streak = open
        .filter((note) => note.repeat && (note.streak ?? 0) >= 3)
        .sort((a, b) => (b.streak ?? 0) - (a.streak ?? 0))[0];
      if (streak) lines.push(`Лучшая серия: «${streak.text}» — ${streak.streak} подряд.`);
    }

    const work = todos.filter((note) =>
      this.options.isWork(note) &&
      note.dueAt &&
      Date.parse(note.dueAt) >= start &&
      Date.parse(note.dueAt) < end
    );
    if (work.length) {
      const minutes = (items: Note[]) =>
        items.reduce((sum, note) => sum + (note.estimateMinutes ?? 30), 0);
      lines.push(
        `Рабочие часы: запланировано ${hoursText(minutes(work))}, сделано ${hoursText(minutes(work.filter((note) => note.done)))}.`,
      );
    }

    lines.push(
      next.length
        ? `На следующую неделю дел: ${next.length}` +
          (busiest && busiest[1] > 1
            ? `, самый загруженный день — ${busiest[0]} (${busiest[1]})`
            : "") +
          "."
        : "На следующую неделю дел со сроком пока нет.",
    );

    return {
      text: lines.join("\n"),
      short: `Сделано за неделю: ${done.length}` +
        (stuck.length ? `, застряло: ${stuck.length}` : ""),
    };
  }

  async runBrief(now = this.options.now(), force = false): Promise<Note | null> {
    if (this.composing || (!force && this.options.getAutoState().briefDay === localKey(now))) return null;

    this.composing = true;
    try {
      this.options.getAutoState().briefDay = localKey(now);
      const facts = this.briefFacts(now);
      let body = facts.text.split("\n").slice(1).join("\n") || facts.text;
      const compose = this.options.getComposer();

      if (compose) {
        const words = await Promise.race([
          compose(facts.text).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000)),
        ]);
        if (words && words.trim()) body = words.trim().slice(0, MAX_AUTO_TEXT);
      }

      return await this.writeAuto("brief", body, "Утренняя сводка. " + facts.short, now, force);
    } finally {
      this.composing = false;
    }
  }

  async runEvening(now = this.options.now(), force = false): Promise<Note | null> {
    if (this.composing || (!force && this.options.getAutoState().eveningDay === localKey(now))) return null;
    this.options.getAutoState().eveningDay = localKey(now);
    const facts = this.eveningFacts(now);
    return this.writeAuto("evening", facts.text, "Итог дня. " + facts.short, now, force);
  }

  async runWeek(now = this.options.now(), force = false): Promise<Note | null> {
    if (this.composing || (!force && this.options.getAutoState().weekDay === localKey(now))) return null;
    this.options.getAutoState().weekDay = localKey(now);
    const facts = this.weekFacts(now);
    return this.writeAuto("week", facts.text, "Обзор недели. " + facts.short, now, force);
  }

  private dayOffAhead(now: number): string[] {
    const result: string[] = [];
    let day = dayStart(now) + 86_400_000 + 3_600_000;
    for (let i = 0; i < 14 && !this.dayKind(localKey(day)).work; i++) day += 86_400_000;

    const key = localKey(day);
    const todos = this.options.getNotes()
      .filter((note) =>
        note.kind === "todo" &&
        !note.done &&
        note.dueAt &&
        localKey(Date.parse(note.dueAt)) === key
      )
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));

    const when = key === localKey(dayStart(now) + 86_400_000 + 3_600_000)
      ? "завтра"
      : new Date(day).toLocaleDateString("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    result.push(
      `Следующий рабочий день — ${when}: ` +
      (todos.length ? `дел ${todos.length}, первое — ${todos[0]!.text}.` : "дел со сроком пока нет."),
    );

    const goal = this.options.missionBoard().find((mission) => mission.status === "active" && mission.next);
    if (goal) result.push(`Цель «${goal.title}»: следующий шаг — ${goal.next!.text}.`);

    const holiday = nextHoliday(localKey(now), 60);
    if (holiday) {
      result.push(
        `Ближайший праздник: ${new Date(holiday.key + "T12:00").toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
        })}, ${holiday.note}, через ${holiday.days} ${dayWord(holiday.days)}.`,
      );
    }

    return result;
  }

  private async writeAuto(
    kind: AutoNote,
    body: string,
    ring: string,
    now: number,
    force: boolean,
  ): Promise<Note> {
    const notes = this.options.getNotes().filter((note) => note.auto !== kind);
    const note: Note = {
      id: randomUUID(),
      kind: "note",
      text: body.slice(0, MAX_AUTO_TEXT),
      done: false,
      createdAt: new Date(now).toISOString(),
      auto: kind,
    };
    notes.push(note);
    this.options.replaceNotes(notes);

    const stamp = new Date(now).toISOString();
    if (!force) {
      for (const reminder of this.options.getReminders()) {
        if (reminder.source === kind && reminder.status === "due") reminder.status = "done";
      }
      this.options.getReminders().push({
        id: randomUUID(),
        text: ring.slice(0, MAX_TEXT),
        at: stamp,
        createdAt: stamp,
        status: "due",
        firedAt: stamp,
        source: kind,
      });
    }

    const what = kind === "brief" ? "утреннюю сводку" : kind === "evening" ? "итог дня" : "обзор недели";
    if (!force) this.options.addLog(kind, "Составила " + what, { created: [note.id] });

    this.options.pruneReminders();
    await this.options.save();
    return { ...note };
  }
}
