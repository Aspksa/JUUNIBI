import { rm as remove } from "node:fs/promises";
import type { PathLike, RmOptions } from "node:fs";

/** Retry transient Windows locks during test cleanup, without hiding persistent errors. */
export function rm(file: PathLike, options: RmOptions = {}): Promise<void> {
  return remove(file, options.recursive
    ? { ...options, maxRetries: options.maxRetries ?? 5, retryDelay: options.retryDelay ?? 100 }
    : options);
}
