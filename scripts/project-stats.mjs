#!/usr/bin/env node
/**
 * «Жизнь проекта»: 50 unusual figures about JUUNIBI computed from its git history and current files.
 * Runs on GitHub (workflow stats.yml publishes the result to the `stats` branch, which installs without
 * .git download) and locally when the folder is a git checkout. Read-only: it never changes the repo.
 *
 *   node scripts/project-stats.mjs [--out file.json]
 * GITHUB_TOKEN + GITHUB_REPOSITORY (set in Actions) add the CI figures.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAY = 86_400_000;
/** Lockfiles, images and maps would drown every figure: they are left out everywhere. */
const IGNORED = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|webp|map|zip|woff2?)$/i;
const CODE = /\.(ts|tsx|mjs|cjs|js|css|html|py)$/i;
const TEST = /(^|\/)(test|tests)\/|\.test\.[cm]?[jt]s$/;
const LOGIC = /^(apps\/server\/src|packages\/[^/]+\/src)\//;
const FIX = /(fix|исправ|ошибк|баг|bug|почин|сломал)/i;
const URGENT = /(hotfix|срочн|urgent|crash|падает|упал|не запуска)/i;
const CLEAN = /(удал|убра|remove|clean|чист|рефактор|refactor|упрост)/i;

const fmt = (n) => Math.round(n).toLocaleString("ru-RU");
const plural = (n, [one, few, many]) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const dayKey = (iso) => iso.slice(0, 10);
const ruDate = (iso) => new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const shortDate = (iso) => new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const age = (ms) => ms < DAY ? `${Math.max(1, Math.round(ms / 3_600_000))} ч` : `${Math.round(ms / DAY)} ${plural(Math.round(ms / DAY), ["день", "дня", "дней"])}`;
const cut = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const dir2 = (p) => p.split("/").slice(0, -1).slice(0, 3).join("/") || ".";
const words = (s) => s.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

/** Every commit, oldest first: date, subject and per-file line counts (renames counted as delete + create). */
function readLog(cwd) {
  const out = git(cwd, ["log", "--reverse", "--no-renames", "--format=%x1e%H%x1f%aI%x1f%s", "--numstat", "--summary"]);
  const commits = [];
  for (const chunk of out.split("\x1e").slice(1)) {
    const [head, ...rest] = chunk.split("\n");
    const [sha, date, subject] = head.split("\x1f");
    const c = { sha, date, subject: subject ?? "", files: [], created: [], deleted: [], add: 0, del: 0 };
    for (const line of rest) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (m) {
        if (IGNORED.test(m[3]) || m[1] === "-") continue;
        const add = Number(m[1]), del = Number(m[2]);
        c.files.push({ path: m[3], add, del }); c.add += add; c.del += del;
        continue;
      }
      const s = /^ (create|delete) mode \d+ (.+)$/.exec(line);
      if (s && !IGNORED.test(s[2])) (s[1] === "create" ? c.created : c.deleted).push(s[2]);
    }
    commits.push(c);
  }
  return commits;
}

/** Words on added and removed lines of each commit, and the function names that were removed. */
function readWords(cwd) {
  const out = git(cwd, ["log", "--reverse", "--no-renames", "--format=%x1e%H", "-p", "--unified=0", "--no-color", "--no-ext-diff"]);
  const perCommit = new Map();
  const removedFns = new Set(), addedFns = new Set();
  for (const chunk of out.split("\x1e").slice(1)) {
    const nl = chunk.indexOf("\n");
    const sha = chunk.slice(0, nl);
    let file = "", add = 0, del = 0;
    for (const line of chunk.slice(nl + 1).split("\n")) {
      if (line.startsWith("diff --git ")) { file = line.split(" b/").pop() ?? ""; continue; }
      if (IGNORED.test(file) || line.startsWith("+++") || line.startsWith("---")) continue;
      if (line[0] === "+") { add += words(line); const f = /function\s+([A-Za-z_$][\w$]*)/.exec(line); if (f) addedFns.add(f[1]); }
      else if (line[0] === "-") { del += words(line); const f = /function\s+([A-Za-z_$][\w$]*)/.exec(line); if (f) removedFns.add(f[1]); }
    }
    perCommit.set(sha, { add, del });
  }
  return { perCommit, removedFns, addedFns };
}

function treeSize(cwd, rev) {
  if (!rev) return 0;
  let total = 0;
  for (const line of git(cwd, ["ls-tree", "-r", "-l", rev]).split("\n")) {
    const m = /^\S+ blob \S+\s+(\d+)\t(.+)$/.exec(line);
    if (m && !IGNORED.test(m[2])) total += Number(m[1]);
  }
  return total;
}

/** Lines still unchanged since the first day of the project (git blame over the code files). */
function ancientLines(cwd, files, firstDay) {
  let old = 0, all = 0;
  for (const f of files) {
    if (!CODE.test(f.path)) continue;
    let out = "";
    try { out = git(cwd, ["blame", "-w", "--line-porcelain", "HEAD", "--", f.path]); } catch { continue; }
    for (const line of out.split("\n")) {
      if (!line.startsWith("author-time ")) continue;
      all++;
      if (new Date(Number(line.slice(12)) * 1000).toISOString().slice(0, 10) === firstDay) old++;
    }
  }
  return { old, all };
}

async function ciFigures() {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=100`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const runs = (await r.json()).workflow_runs.filter((x) => x.status === "completed" && x.name !== "Жизнь проекта");
    const finished = runs.filter((x) => x.conclusion === "success" || x.conclusion === "failure");
    const ok = finished.filter((x) => x.conclusion === "success").length;
    const times = runs.filter((x) => x.run_started_at).map((x) => (Date.parse(x.updated_at) - Date.parse(x.run_started_at)) / 1000).filter((s) => s > 0 && s < 3600);
    return { runs: finished.length, ok, avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0, last: times.slice(0, 10).reverse() };
  } catch { return null; }
}

export async function computeStats(cwd = process.cwd(), now = Date.now()) {
  const commits = readLog(cwd);
  if (!commits.length) throw new Error("В репозитории нет коммитов");
  const { perCommit, removedFns, addedFns } = readWords(cwd);
  const tracked = git(cwd, ["ls-files"]).split("\n").filter((p) => p && !IGNORED.test(p));
  const files = [];
  for (const p of tracked) {
    try {
      const text = readFileSync(path.join(cwd, p), "utf8");
      files.push({ path: p, lines: text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0, bytes: statSync(path.join(cwd, p)).size, text });
    } catch { /* deleted locally or unreadable */ }
  }
  const present = new Set(files.map((f) => f.path));
  const first = commits[0], last = commits[commits.length - 1];
  const firstDay = dayKey(first.date);

  // per-file and per-day bookkeeping
  const touches = new Map(), lastChange = new Map(), net = new Map(), dirCommits = new Map(), dirFixes = new Map();
  const byDay = new Map(), hours = new Array(24).fill(0);
  let wordsAdded = 0, wordsRemoved = 0, wordsRewritten = 0, logicLines = 0, allLines = 0, memoryCommits = 0, nightCommits = 0, cleanupLines = 0;
  let fixes = 0, urgent = 0, prev = 0, bigBang = first, record = first;
  const prs = [];
  for (const c of commits) {
    const t = Date.parse(c.date);
    const w = perCommit.get(c.sha) ?? { add: 0, del: 0 };
    wordsAdded += w.add; wordsRemoved += w.del; wordsRewritten += Math.min(w.add, w.del);
    const hour = Number(c.date.slice(11, 13));
    hours[hour]++;
    if (hour < 6) nightCommits++;
    const d = byDay.get(dayKey(c.date)) ?? { commits: 0, add: 0, del: 0 };
    d.commits++; d.add += c.add; d.del += c.del; byDay.set(dayKey(c.date), d);
    const isFix = FIX.test(c.subject);
    if (isFix) fixes++;
    if (isFix && (URGENT.test(c.subject) || (prev && t - prev < 3_600_000))) urgent++;
    if (CLEAN.test(c.subject)) cleanupLines += c.del;
    if (c.files.some((f) => /memory/i.test(f.path))) memoryCommits++;
    if (c.files.length > bigBang.files.length) bigBang = c;
    if (c.add + c.del > record.add + record.del) record = c;
    const pr = /\(#(\d+)\)\s*$/.exec(c.subject);
    if (pr) prs.push({ n: Number(pr[1]), title: c.subject.replace(/\s*\(#\d+\)\s*$/, ""), date: c.date });
    const dirs = new Set();
    for (const f of c.files) {
      touches.set(f.path, (touches.get(f.path) ?? 0) + 1);
      lastChange.set(f.path, t);
      net.set(f.path, (net.get(f.path) ?? 0) + f.add - f.del);
      allLines += f.add + f.del;
      if (LOGIC.test(f.path) && !TEST.test(f.path)) logicLines += f.add + f.del;
      dirs.add(dir2(f.path));
    }
    for (const dir of dirs) {
      dirCommits.set(dir, (dirCommits.get(dir) ?? 0) + 1);
      if (isFix) dirFixes.set(dir, (dirFixes.get(dir) ?? 0) + 1);
    }
    prev = t;
  }
  const top = (m, keep = () => true) => [...m.entries()].filter(([k]) => keep(k)).sort((a, b) => b[1] - a[1])[0];
  const created = commits.flatMap((c) => c.created.map((p) => ({ p, t: Date.parse(c.date) })));
  const deleted = commits.flatMap((c) => c.deleted.map((p) => ({ p, t: Date.parse(c.date) })));
  const week = (t) => now - t < 7 * DAY;
  const code = files.filter((f) => CODE.test(f.path));
  const giant = [...code].sort((a, b) => b.lines - a.lines)[0];
  const tiny = code.filter((f) => f.lines > 0).sort((a, b) => a.lines - b.lines)[0];
  const oldest = [...lastChange.entries()].filter(([p]) => present.has(p)).sort((a, b) => a[1] - b[1])[0];
  const hot = top(touches, (p) => present.has(p));
  const grown = top(net, (p) => present.has(p));
  const sources = code.filter((f) => LOGIC.test(f.path) || /^apps\/web\/src\//.test(f.path)).filter((f) => !TEST.test(f.path));
  const testFiles = files.filter((f) => TEST.test(f.path));
  const tests = testFiles.reduce((n, f) => n + (f.text.match(/\b(it|test)(\.each\([^)]*\))?\(\s*["'`]/g)?.length ?? 0), 0);
  const tools = files.filter((f) => /assistant-tools\.ts$/.test(f.path)).reduce((n, f) => n + (f.text.match(/\bname:\s*"[a-z_]+"/g)?.length ?? 0), 0);
  const guards = sources.reduce((n, f) => n + (f.text.match(/throw\s+(bad\(|new Error|Object\.assign\(new Error)/g)?.length ?? 0), 0);
  const imports = sources.reduce((n, f) => n + (f.text.match(/from\s+["'](\.{1,2}\/|@juunibi\/)[^"']+["']/g)?.length ?? 0), 0);
  const packages = new Set(sources.map((f) => f.path.split("/").slice(0, 2).join("/"))).size;
  const ghosts = [...removedFns].filter((n) => !addedFns.has(n) || !files.some((f) => CODE.test(f.path) && f.text.includes("function " + n)));
  const days = [...byDay.keys()].sort();
  let best = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    run = Date.parse(days[i]) - Date.parse(days[i - 1]) === DAY ? run + 1 : 1;
    best = Math.max(best, run);
  }
  let current = 0;
  for (let t = Date.parse(new Date(now).toISOString().slice(0, 10)); byDay.has(new Date(t).toISOString().slice(0, 10)); t -= DAY) current++;
  const busiest = [...byDay.entries()].sort((a, b) => b[1].commits - a[1].commits)[0];
  const upheaval = [...byDay.entries()].sort((a, b) => b[1].del - a[1].del)[0];
  const leap = [...byDay.entries()].sort((a, b) => (b[1].add - b[1].del) - (a[1].add - a[1].del))[0];
  const peakHour = hours.indexOf(Math.max(...hours));
  const calendar = [];
  for (let i = 34; i >= 0; i--) calendar.push(byDay.get(new Date(now - i * DAY).toISOString().slice(0, 10))?.commits ?? 0);
  const thisWeek = commits.filter((c) => now - Date.parse(c.date) < 7 * DAY).length;
  const lastWeek = commits.filter((c) => now - Date.parse(c.date) >= 7 * DAY && now - Date.parse(c.date) < 14 * DAY).length;
  const weekAgo = git(cwd, ["rev-list", "-1", `--before=${new Date(now - 7 * DAY).toISOString()}`, "HEAD"]).trim();
  const weightNow = treeSize(cwd, "HEAD"), weightBefore = treeSize(cwd, weekAgo || first.sha);
  const ancient = ancientLines(cwd, files, firstDay);
  const frozen = files.filter((f) => lastChange.has(f.path) && now - lastChange.get(f.path) > 7 * DAY).length;
  const king = top(dirCommits);
  const hardest = top(dirFixes);
  const ci = await ciFigures();
  let branches = 0, tags = 0;
  try { branches = git(cwd, ["branch", "-r"]).split("\n").filter((l) => l.trim() && !l.includes("->")).length; tags = git(cwd, ["tag"]).split("\n").filter(Boolean).length; } catch { /* no remotes */ }
  const totalLines = files.reduce((n, f) => n + f.lines, 0);
  const birthday = new Date(first.date);
  const nextBirthday = new Date(Date.UTC(new Date(now).getUTCFullYear(), birthday.getUTCMonth(), birthday.getUTCDate()));
  if (nextBirthday.getTime() < now - DAY) nextBirthday.setUTCFullYear(nextBirthday.getUTCFullYear() + 1);
  const toBirthday = Math.ceil((nextBirthday.getTime() - now) / DAY);
  const years = nextBirthday.getUTCFullYear() - birthday.getUTCFullYear();
  const exts = new Set(code.map((f) => f.path.split(".").pop()));

  const achievements = [
    ["Первый коммит", true], ["Ночная сова", nightCommits > 0], ["Марафонец: 3 дня подряд", best >= 3], ["Сто коммитов", commits.length >= 100],
    ["Десять тысяч строк", totalLines >= 10_000], ["Большой взрыв: 50 файлов разом", bigBang.files.length >= 50],
    ["Чистюля: удалено больше, чем добавлено", commits.some((c) => c.del > c.add && c.del >= 200)], ["Тестировщик: 300 тестов", tests >= 300],
    ["Полиглот: 4 языка", exts.size >= 4], ["Сто PR", prs.length >= 100],
  ];
  const unlocked = achievements.filter(([, ok]) => ok).map(([t]) => t);
  const book = [{ date: first.date, text: "Рождение: " + cut(first.subject, 60) }, ...prs.slice(-7).map((p) => ({ date: p.date, text: `#${p.n} ${cut(p.title, 60)}` }))];

  const M = [];
  const add = (group, id, emoji, title, hint, value, detail = "", extra = {}) => M.push({ id, group, emoji, title, hint, value, detail, ...extra });
  // ---- Анатомия файлов
  add("anatomy", "words_added", "📜", "Сколько слов родилось", "Все добавленные слова", fmt(wordsAdded), `за ${commits.length} ${plural(commits.length, ["коммит", "коммита", "коммитов"])}`);
  add("anatomy", "words_removed", "✂️", "Сколько слов исчезло", "Удалённые слова", fmt(wordsRemoved), wordsAdded ? `${Math.round((100 * wordsRemoved) / wordsAdded)}% от родившихся` : "");
  add("anatomy", "words_rewritten", "🔄", "Переписанная история", "Сколько слов заменили", fmt(wordsRewritten), "слова, ушедшие ради новых");
  add("anatomy", "files_born", "🍼", "Новорождённые файлы", "Создано за период", fmt(created.length), `за неделю: ${created.filter((x) => week(x.t)).length}`);
  add("anatomy", "files_graveyard", "💀", "Кладбище файлов", "Сколько удалено", fmt(deleted.length), deleted.slice(-3).map((x) => x.p.split("/").pop()).join(", "));
  add("anatomy", "giant", "🏋️", "Файл-гигант", "Самый большой файл", giant ? `${fmt(giant.lines)} ${plural(giant.lines, ["строка", "строки", "строк"])}` : "—", giant?.path ?? "");
  add("anatomy", "tiny", "🐜", "Самый маленький", "Минимум строк", tiny ? `${fmt(tiny.lines)} ${plural(tiny.lines, ["строка", "строки", "строк"])}` : "—", tiny?.path ?? "");
  add("anatomy", "oldtimer", "🏚️", "Старожил проекта", "Дольше всех без изменений", oldest ? age(now - oldest[1]) : "—", oldest?.[0] ?? "");
  add("anatomy", "hot", "🔥", "Горячий файл", "Чаще всего редактировали", hot ? `${hot[1]} ${plural(hot[1], ["правка", "правки", "правок"])}` : "—", hot?.[0] ?? "");
  add("anatomy", "grown", "🌱", "Самый выросший", "Максимальный прирост строк", grown ? `+${fmt(grown[1])}` : "—", grown?.[0] ?? "");
  // ---- Интеллект и возможности
  add("mind", "brain", "🧠", "Рост мозга", "Изменения файлов логики", `${fmt(logicLines)} ${plural(logicLines, ["строка", "строки", "строк"])}`, allLines ? `${Math.round((100 * logicLines) / allLines)}% всех правок` : "");
  add("mind", "abilities", "🧩", "Новые способности", "Добавленные модули", fmt(created.filter((x) => LOGIC.test(x.p) && !TEST.test(x.p) && present.has(x.p)).length), `за неделю: ${created.filter((x) => LOGIC.test(x.p) && !TEST.test(x.p) && week(x.t)).length}`);
  add("mind", "library", "📚", "Библиотека знаний", "Объём базы знаний", "—", "считает работающий JUUNIBI");
  add("mind", "links", "🔗", "Новые связи", "Рост графа знаний", "—", "считает работающий JUUNIBI");
  add("mind", "memory", "💭", "Развитие памяти", "Новые функции памяти", `${memoryCommits} ${plural(memoryCommits, ["коммит", "коммита", "коммитов"])}`, `файлов памяти: ${files.filter((f) => /memory/i.test(f.path) && !TEST.test(f.path)).length}`);
  add("mind", "tools", "🦾", "Новые инструменты", "Подключённые действия", fmt(tools), "инструментов у помощницы");
  add("mind", "guards", "🛡️", "Защитные механизмы", "Новые проверки", fmt(guards), "проверок входных данных в коде");
  add("mind", "organs", "⚙️", "Внутренние органы", "Активные подсистемы", fmt(sources.length), `файлов кода в ${packages} ${plural(packages, ["части", "частях", "частях"])}`);
  add("mind", "age", "🦊", "Возраст JUUNIBI", "Дней с первого коммита", age(now - Date.parse(first.date)), "с " + ruDate(first.date));
  add("mind", "experiments", "🧪", "Эксперименты", "Проверенные изменения", fmt(prs.length), prs.length ? `последний: #${prs[prs.length - 1].n}` : "PR ещё не было");
  // ---- Жизнь и история
  add("life", "night", "🌙", "Ночные обновления", "Изменения после полуночи", fmt(nightCommits), `${Math.round((100 * nightCommits) / commits.length)}% коммитов с 00 до 06`);
  add("life", "best_day", "☀️", "Самый продуктивный день", "Максимум изменений", `${busiest[1].commits} ${plural(busiest[1].commits, ["коммит", "коммита", "коммитов"])}`, ruDate(busiest[0]));
  add("life", "record", "🏆", "Рекорд разработки", "Крупнейший коммит", `${fmt(record.add + record.del)} ${plural(record.add + record.del, ["строка", "строки", "строк"])}`, cut(record.subject));
  add("life", "streak", "🔥", "Серия активности", "Дней подряд с коммитами", `${best} ${plural(best, ["день", "дня", "дней"])}`, `текущая: ${current}`);
  add("life", "hours", "🕰️", "Часы развития", "Когда чаще обновляется", `${String(peakHour).padStart(2, "0")}:00`, "пик по времени автора", { kind: "hours", series: hours });
  add("life", "upheaval", "🌪️", "День переворота", "Максимум переписанного кода", `−${fmt(upheaval[1].del)}`, ruDate(upheaval[0]));
  add("life", "hardest", "🛠️", "Самый трудный модуль", "Чаще всего исправлялся", hardest ? `${hardest[1]} ${plural(hardest[1], ["исправление", "исправления", "исправлений"])}` : "0", hardest?.[0] ?? "");
  add("life", "calendar", "🗓️", "История по дням", "Календарь активности", `${calendar.filter(Boolean).length} из 35`, "активных дней за 5 недель", { kind: "calendar", series: calendar });
  add("life", "week", "📈", "Рост за неделю", "Сравнение с предыдущей", lastWeek ? `${thisWeek >= lastWeek ? "+" : "−"}${Math.abs(Math.round((100 * (thisWeek - lastWeek)) / lastWeek))}%` : `+${thisWeek}`, `${thisWeek} ${plural(thisWeek, ["коммит", "коммита", "коммитов"])} против ${lastWeek} неделей раньше`);
  add("life", "birthday", "🎂", "День рождения", "Годовщина создания", shortDate(first.date), `через ${toBirthday} ${plural(toBirthday, ["день", "дня", "дней"])} исполнится ${years} ${plural(years, ["год", "года", "лет"])}`);
  // ---- Надёжность и скорость
  add("care", "bugs", "🐛", "Охота на ошибки", "Подтверждённые исправления", fmt(fixes), `${Math.round((100 * fixes) / commits.length)}% коммитов`);
  add("care", "urgent", "🚨", "Аварийные обновления", "Срочные исправления", fmt(urgent), "исправления меньше чем через час");
  add("care", "rescued", "🧯", "Спасённые установки", "Успешные откаты", "—", "считает работающий JUUNIBI");
  add("care", "green", "💚", "Зелёные проверки", "Доля успешного CI", ci?.runs ? `${Math.round((100 * ci.ok) / ci.runs)}%` : "—", ci?.runs ? `${ci.ok} из ${ci.runs} запусков` : "считается на GitHub");
  add("care", "build", "🚀", "Скорость сборки", "Средняя длительность", ci?.avg ? `${Math.round(ci.avg)} с` : "—", ci?.avg ? "проверка на Windows и Linux" : "считается на GitHub", ci?.last?.length ? { kind: "spark", series: ci.last.map(Math.round) } : {});
  add("care", "weight", "📦", "Вес программы", "Изменение размера", `${(weightNow / 1048576).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`, `${weightNow >= weightBefore ? "+" : "−"}${fmt(Math.abs(weightNow - weightBefore) / 1024)} КБ за неделю`);
  add("care", "startup", "💨", "Ускорение запуска", "До и после", "—", "считает работающий JUUNIBI");
  add("care", "tests", "🔍", "Глубина проверок", "Число тестов", fmt(tests), `в ${testFiles.length} ${plural(testFiles.length, ["файле", "файлах", "файлах"])}`);
  add("care", "cleanup", "🧹", "Генеральная уборка", "Удалённый устаревший код", `${fmt(cleanupLines)} ${plural(cleanupLines, ["строка", "строки", "строк"])}`, "в коммитах про уборку");
  add("care", "integrity", "🔐", "Контроль целостности", "Проверенные файлы", fmt(files.length), "файлов под контролем версий");
  // ---- Секретные и забавные рекорды
  add("fun", "king", "👑", "Король изменений", "Самый редактируемый модуль", king ? `${king[1]} ${plural(king[1], ["коммит", "коммита", "коммитов"])}` : "—", king?.[0] ?? "");
  add("fun", "ancient", "🦖", "Древнейший код", "Старейшие неизменные строки", fmt(ancient.old), ancient.all ? `${Math.round((100 * ancient.old) / ancient.all)}% кода живёт с ${shortDate(first.date)}` : "");
  add("fun", "ghosts", "👻", "Призраки прошлого", "Удалённые старые функции", fmt(ghosts.length), ghosts.slice(0, 3).join(", "));
  add("fun", "leap", "🧬", "Эволюционный скачок", "Резкий рост проекта", `+${fmt(leap[1].add - leap[1].del)}`, ruDate(leap[0]));
  add("fun", "frozen", "🧊", "Замороженные файлы", "Давно не менялись", fmt(frozen), `из ${files.length}, без правок больше недели`);
  add("fun", "big_bang", "🧨", "Большой взрыв", "Самое масштабное обновление", `${bigBang.files.length} ${plural(bigBang.files.length, ["файл", "файла", "файлов"])}`, cut(bigBang.subject));
  add("fun", "universe", "🌌", "Вселенная зависимостей", "Связи между модулями", fmt(imports), `импортов в ${sources.length} файлах`);
  add("fun", "rare", "💎", "Редкие достижения", "Необычные рекорды", `${unlocked.length} из ${achievements.length}`, unlocked.slice(-2).join(", "), { kind: "list", list: achievements.map(([t, ok]) => (ok ? "✓ " : "· ") + t) });
  add("fun", "tree", "🌳", "Дерево поколений", "История версий и веток", `${prs.length} PR`, `веток: ${branches}, выпусков: ${tags}`);
  add("fun", "book", "📖", "Книга жизни", "Автоматическая хроника", `${book.length} глав`, "от рождения до сегодня", { kind: "list", list: book.map((b) => `${shortDate(b.date)} · ${b.text}`) });

  return {
    version: 1, generatedAt: new Date(now).toISOString(), head: last.sha, commits: commits.length,
    groups: [
      { id: "anatomy", title: "Анатомия файлов" }, { id: "mind", title: "Интеллект и возможности" }, { id: "life", title: "Жизнь и история" },
      { id: "care", title: "Надёжность и скорость" }, { id: "fun", title: "Секретные и забавные рекорды" },
    ],
    metrics: M,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outAt = process.argv.indexOf("--out");
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const stats = await computeStats(cwd);
  const json = JSON.stringify(stats, null, outAt > 0 ? 1 : 0);
  if (outAt > 0) writeFileSync(process.argv[outAt + 1], json + "\n"); else process.stdout.write(json);
}
