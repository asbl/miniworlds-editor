export const ROOM_PATTERN: RegExp
export const DEFAULTS: Record<string, unknown>
export function createRelay(options?: Record<string, unknown>): {
  server: import('node:http').Server
  rooms: Map<string, { conns: Map<unknown, unknown>; readers: Set<unknown> }>
  listen(port: number, host?: string): Promise<{ port: number } | string | null>
  close(): Promise<void>
}
export const CLOSE: { full: 4001; serverFull: 4002; refused: 4003; tooMany: 4004; badRoom: 4005; notFound: 4006 }
