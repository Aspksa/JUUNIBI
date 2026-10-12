# KITSUNE TREE — UX/UI audit and design rules

## Existing module review (v7)
- Eleven equal-weight tabs made orientation difficult. Keep a high-signal overview and visible section label; scrolling tabs must remain keyboard-accessible.
- The diagram exposed node positions only to pointer devices. Provide Alt + arrow positioning and distinct focus rings.
- Discovery candidates and confirmed architecture could be confused. Keep candidates in Discovery and confirmed snapshot deltas in Growth, using different language.
- No trusted event semantics for growth; animation must correspond to a persisted installation or two versioned architecture snapshots.
- Graph, comparison, updates and chat need explicit empty/loading states. Do not suggest progress if source evidence is missing.
- Performance: cap effects, animate only transform/opacity; always honor reduced-motion. Avoid a permanent particle loop.
- Responsive layouts: overview collapses to two columns, inspector stops being sticky on mobile, tabs horizontally scroll.

## Interaction map
1. Overview: status and four glanceable metrics. These are counts, not quality ratings.
2. Navigation: graph, development, dependency analysis, discovery, history, Brain and confirmed growth.
3. Graph: click/Enter to select; pointer drag or Alt+Arrow to reposition; toolbar zoom. Persist positions locally.
4. Growth: install/rollback event and exact snapshot diff. A missing historical snapshot is a truthful empty state.
5. Detail panel: selected-branch explanation, upstream/downstream context and provenance.
6. Safety: candidate discoveries are unverified. Brain analyses are advisory. Never infer installed capability from filenames.
7. Accessibility: visible focus rings, labeled search and timeline, reduced motion.

## Acceptance criteria
- New branch does not glow without a verified pair of snapshots.
- Rollback uses a separate recovery presentation.
- Existing interfaces remain available; no destructive layout migration.
- All motion may be disabled through system settings.
- CI verifies both web and server on Linux and Windows.

## v10 · calm redesign (no looping animation)
- **Four sections instead of thirteen tabs:** Карта (Дерево, Граф, Связи, Этапы), История (Обновления, Хронология, Происхождение, Сравнение, Рост), Анализ (Влияние, Обнаружение, Архитектор, Диалог с Brain), Лисичка (Сегодня, Показатели, Награды, Ветки). The grouping lives in `kitsune-sections.ts` and is tested so every mode belongs to exactly one section.
- **The tree as a still picture** (`kitsune-tree-art.ts`): trunk at the bottom, later stages upward; filled leaf = confirmed, dashed outline = planned, green ring = new branch. Layout is deterministic and tested; nodes are keyboard-operable buttons. Details open in the centered window used elsewhere in the app.
- **One award shelf** (`kitsune-medals.ts`): 200 awards (10 special, 90 keepers, 100 legendary) as round medals with a progress ring. Tier = difficulty (bronze keepers, silver special, gold/legend by rank inside a legendary theme); locked awards are silhouettes; an award never shows progress that is not measured.
- **Fixes found while reviewing the page:** the browser could not call GitHub (CSP) so PR/CI branches never loaded — the server now proxies and caches two read-only calls (`/api/kitsune/github/pulls|runs`, with the update centre's token, ETag cache and rate-limit handling); the active tab was unreadable (light text on a light pill); discovery listed test files as "new modules" and counted type-only imports as cycles; failed/rolled-back-at-start installs were missing from the Updates view; focus was lost when async data redrew the page; long hashes overlapped neighbouring cells.

## v11 · одно дерево
- **Одна страница вместо четырёх разделов:** слева панель («Сегодня» — 34 из 100, ближайшая награда, вести, дневник, лесной отчёт; ниже все разделы одним списком), справа одно большое дерево. Состав панели — `kitsune-sections.ts` (`RAIL`), он покрыт тестом: каждый режим доступен из панели, подписи на русском.
- **Дерево:** ствол и ветви — модули проекта; **крона** — 100 показателей в 10 «кустах» (куст показывает «5 из 10», клик открывает окно с десятью карточками мира); **плоды** — полученные награды. Слои одного рисунка: «Структура», «Связи» (↑ нужны / ↓ зависят), «Этапы» (полосы уровней), «Что сломается, если…» (зависимые ветви красным, цифра — шагов до них). Подробности ветви, куста и медали — всегда окном по центру.
- **Ползунок времени** (`kitsune-time.ts`): кадры — реально сохранённые снимки архитектуры (дата берётся из журнала установок), последний кадр — «Сейчас». Без двух кадров ползунок отключён и честно пишет «данных нет».
- **Связь установок с ветвями:** при установке в историю пишется, что она принесла (названия изменений и их номера); ветви определяются по разнице снимков архитектуры (точно), а по описанию — только как догадка, и это подписано.
- **Награды:** ступень считается по порогам награды, а не по виду: `сложность = Σ log2(1 + порог) + 0,5 × дни измерений`; бронза до 3, серебро до 6, золото до 9, дальше легенда. В окне награды сложность показана числом.
- **Лесной отчёт:** карточка за 7 дней (три события, ближайшая награда, что ещё не подтверждено) с сохранением в PNG; события берутся только из лесного дневника.
- **Русский язык:** названия ветвей переводятся при показе (манифест и старые снимки остаются как есть), версии показываются короткими кодами, «Brain», «PR», «CI», «SHA», «SQLite» заменены понятными словами. Исключение — имена файлов в «Обнаружении».
- **Python:** если Python 3.8+ не найден, дерево работает без сохранённых снимков и сообщает, что установить.


## v12 — «Атлас»

Новый раздел «Атлас» в левой панели: ствол JUUNIBI внизу, цветные ветви-кланы (мозг, дела, диск, лес показателей, награды, модули, код, лисье древо), венки листьев вокруг хабов. Только реальные данные. Масштаб и перетаскивание колесом/мышью/клавиатурой (без анимации), подписи появляются по уровням приближения, поиск по узлам, фильтр по клану, на телефоне — список вместо карты. Клик по узлу открывает окно по центру. Компактная «Структура» осталась.
