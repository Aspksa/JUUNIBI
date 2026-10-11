/**
 * Picture previews for PDFs (first page) and videos (a frame): drawn once in the browser when the tile
 * comes into view, then kept by the server by content, so the next visit just shows an <img>.
 * One file at a time, never more than a few seconds each; a failure leaves the coloured badge.
 */
import { diskRawUrl, type DiskFile } from "../api";
import { madeThumb } from "./disk-model";

const SIZE = 360;
const failed = new Set<string>(), made = new Set<string>();
/** Waiting files by content: a tile drawn again while its file waits only adds a listener. */
const waiting = new Map<string, ((ok: boolean) => void)[]>();
const queue: DiskFile[] = [];
/** Made during this visit, before the catalogue says so. */
export const thumbReady = (f: DiskFile) => !!f.thumb || made.has(f.sha256);
let running = false;

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob | null>((res) => c.toBlob(res, "image/webp", 0.82));
const fit = (w: number, h: number) => { const k = SIZE / Math.max(w, h, 1); return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }; };
/** Runs `work` for at most `ms`; on timeout the signal fires so the work drops its download and decoder. */
async function timeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(ctl.signal), new Promise<never>((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(new Error("timeout")); }, ms); })]);
  } finally { clearTimeout(timer); }
}

async function pdfPicture(f: DiskFile, signal: AbortSignal): Promise<Blob | null> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  if (signal.aborted) return null;
  const task = pdfjs.getDocument({ url: diskRawUrl(f), isEvalSupported: false, disableAutoFetch: true });
  const drop = () => void task.destroy();
  signal.addEventListener("abort", drop, { once: true });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const { w } = fit(base.width, base.height);
    const viewport = page.getViewport({ scale: w / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return await toBlob(canvas);
  } finally { signal.removeEventListener("abort", drop); void task.destroy(); }
}

function videoPicture(f: DiskFile, signal: AbortSignal): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.playsInline = true;
    const stop = () => { v.removeAttribute("src"); v.load(); };
    signal.addEventListener("abort", () => { stop(); reject(new Error("timeout")); }, { once: true });
    v.addEventListener("error", () => { stop(); reject(new Error("video")); }, { once: true });
    v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(1.5, (v.duration || 0) / 10); }, { once: true });
    v.addEventListener("seeked", async () => {
      const { w, h } = fit(v.videoWidth, v.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(v, 0, 0, w, h);
      stop();
      resolve(await toBlob(canvas));
    }, { once: true });
    v.src = diskRawUrl(f);
  });
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const kind = madeThumb(f);
      let ok = false;
      try {
        const blob = kind ? await timeout((signal) => kind === "pdf" ? pdfPicture(f, signal) : videoPicture(f, signal), 15000) : null;
        if (blob && blob.size <= 400 * 1024) {
          const r = await fetch("/api/disk/files/" + encodeURIComponent(f.id) + "/thumb", { method: "POST", headers: { "Content-Type": blob.type || "image/webp" }, body: blob });
          ok = r.ok;
        }
      } catch { ok = false; }
      (ok ? made : failed).add(f.sha256);
      for (const cb of waiting.get(f.sha256) ?? []) cb(ok);
      waiting.delete(f.sha256);
    }
  } finally { running = false; }
}

/** Asks for a preview of `f` once its tile is on screen; `done(true)` means `diskThumbUrl(f)` now answers. */
export function wantThumb(tile: HTMLElement, f: DiskFile, done: (ok: boolean) => void): void {
  if (failed.has(f.sha256) || !madeThumb(f) || typeof IntersectionObserver === "undefined") return;
  const io = new IntersectionObserver((seen) => {
    if (!seen.some((x) => x.isIntersecting)) return;
    io.disconnect();
    if (!tile.isConnected) return;
    const list = waiting.get(f.sha256);
    if (list) { list.push(done); return; }
    waiting.set(f.sha256, [done]);
    queue.push(f);
    void pump();
  }, { rootMargin: "200px" });
  io.observe(tile);
}
