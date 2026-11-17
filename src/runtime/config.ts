/** Pyodide is pinned (PLAN, offline cache). Override with VITE_PYODIDE_BASE to self-host (e.g. behind a school firewall). */
export const PYODIDE_VERSION = '0.29.3'
export const PYODIDE_BASE: string =
  (import.meta.env?.VITE_PYODIDE_BASE as string | undefined) ?? `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

/** Soft stop gets this long before the worker is terminated (a program stuck in a loop cannot answer). */
export const STOP_TIMEOUT_MS = 1500
