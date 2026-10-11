import os from "node:os";

/** Local computer snapshot. No shell, subprocesses, paths, secrets or network calls. */
export function computerSnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpu: { logicalCores: cpus.length, model: cpus[0]?.model?.slice(0, 100) ?? "unknown" },
    memory: { totalBytes: total, freeBytes: free, usedPercent: total > 0 ? Math.round(100 * (total - free) / total) : 0 },
    uptimeSeconds: Math.floor(os.uptime()),
    safety: "read-only; no commands executed" as const
  };
}
