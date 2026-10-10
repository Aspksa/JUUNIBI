/** «Проверить всё» on the settings page: one quick check of every outside service the assistant depends on. */
export type CheckStatus = "ok" | "fail" | "skip";
export interface CheckResult { id: "key" | "model" | "fallback" | "embeddings" | "web"; title: string; status: CheckStatus; ms?: number; detail: string }

export interface SelfTestDeps {
  /** undefined while no Cloud.ru key is saved. */
  listModels?: () => Promise<string[]>;
  ping?: (model: string) => Promise<number>;
  embeddings: () => Promise<{ ok: boolean; dims?: number; ms: number; error?: string }>;
  /** undefined when the internet is switched off in the settings. */
  search?: () => Promise<{ provider: string; results: unknown[] }>;
  settings: { model: string; fallbackModel: string; embeddings: boolean };
  now?: () => number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runSelfTest(d: SelfTestDeps): Promise<CheckResult[]> {
  const now = d.now ?? Date.now;
  const timed = async <T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> => {
    const t0 = now();
    try { const value = await fn(); return { ms: now() - t0, value }; } catch (e) { return { ms: now() - t0, error: message(e) }; }
  };
  const noKey = "Ключ Cloud.ru не сохранён";
  const key: Promise<CheckResult> = d.listModels
    ? timed(d.listModels).then((r) => r.error ? { id: "key", title: "Ключ Cloud.ru", status: "fail", ms: r.ms, detail: r.error }
      : { id: "key", title: "Ключ Cloud.ru", status: "ok", ms: r.ms, detail: `Ключ принят, доступно моделей: ${r.value!.length}` })
    : Promise.resolve({ id: "key", title: "Ключ Cloud.ru", status: "fail", detail: noKey });
  const pingOne = (id: "model" | "fallback", title: string, model: string): Promise<CheckResult> => {
    if (!model) return Promise.resolve({ id, title, status: "skip", detail: "Не задана" });
    if (!d.ping) return Promise.resolve({ id, title, status: "skip", detail: noKey });
    const ping = d.ping;
    return timed(() => ping(model)).then((r) => r.error ? { id, title, status: "fail", ms: r.ms, detail: r.error } : { id, title, status: "ok", ms: r.ms, detail: `${model} отвечает` });
  };
  const emb: Promise<CheckResult> = !d.settings.embeddings
    ? Promise.resolve({ id: "embeddings", title: "Поиск по смыслу", status: "skip", detail: "Выключен в настройках" })
    : !d.listModels ? Promise.resolve({ id: "embeddings", title: "Поиск по смыслу", status: "skip", detail: noKey })
    : d.embeddings().then((r) => r.ok ? { id: "embeddings", title: "Поиск по смыслу", status: "ok", ms: r.ms, detail: `Работает, размерность ${r.dims ?? "?"}` }
      : { id: "embeddings", title: "Поиск по смыслу", status: "fail", ms: r.ms, detail: r.error ?? "Нет ответа" }, (e) => ({ id: "embeddings", title: "Поиск по смыслу", status: "fail", detail: message(e) }));
  const web: Promise<CheckResult> = d.search
    ? timed(d.search).then((r) => r.error ? { id: "web", title: "Интернет", status: "fail", ms: r.ms, detail: r.error }
      : { id: "web", title: "Интернет", status: r.value!.results.length ? "ok" : "fail", ms: r.ms, detail: r.value!.results.length ? `Поиск работает (${r.value!.provider})` : "Поиск ничего не нашёл" })
    : Promise.resolve({ id: "web", title: "Интернет", status: "skip", detail: "Выключен в настройках" });
  const fb = d.settings.fallbackModel && d.settings.fallbackModel !== d.settings.model ? d.settings.fallbackModel : "";
  return Promise.all([key, pingOne("model", "Основная модель", d.settings.model), pingOne("fallback", "Запасная модель", fb), emb, web]);
}
