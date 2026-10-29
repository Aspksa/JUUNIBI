export interface PythonInfo { ok: boolean; command?: string; args?: string[]; version?: string; reason?: string }
export type Probe = (command: string, args: string[]) => Promise<{ code: number | null; output: string }>;
export interface PythonOptions { root?: string; env?: NodeJS.ProcessEnv; exists?: (file: string) => boolean }
export const SQLITE_PROBE: string;
export class PythonUnavailableError extends Error { readonly status: number; readonly info: PythonInfo; constructor(info: PythonInfo); }
export function pythonCandidates(platform?: NodeJS.Platform, options?: PythonOptions): [string, string[]][];
export function missingPythonMessage(platform: NodeJS.Platform): string;
export function detectPython(probe: Probe, platform?: NodeJS.Platform, options?: PythonOptions): Promise<PythonInfo>;
export const probePython: Probe;
export function pythonInfo(probe?: Probe, now?: number, options?: PythonOptions): Promise<PythonInfo>;
export function resetPythonCache(): void;
