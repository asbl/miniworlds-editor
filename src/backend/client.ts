import compatibility from '../../public/compatibility.json'

export interface Task {
  assignment_id: number
  title: string
  description: string
  status: string
  version: number
  items: { id: number; kind: string; prompt: string }[]
  answers: Record<string, { checked: boolean }>
}
export interface RemoteProject {
  project_id: number
  title: string
  revision: number
  read_only: boolean
  read_only_reason: string | null
  code_expires_at: string | null
  password_protected: boolean
  save: { source: string; db: string | null; files?: Record<string, string> } | null
  media: { id: number; orig_name: string; filename?: string }[]
  tasks: Task[]
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** No teacher cookies, redirects, caches, URL credentials or unbounded network waits. */
export class BackendClient {
  constructor(readonly base: string, public token: string | null = null, private fetcher: typeof fetch = (...a) => fetch(...a)) {}
  async request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    if (!path.startsWith('/api/')) throw new Error('Invalid API path')
    const headers: Record<string, string> = { 'X-Miniworlds-API': String(compatibility.api.max) }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token && path.startsWith('/api/play/')) headers.Authorization = `Bearer ${this.token}`
    const response = await this.fetcher(`${this.base}${path}`, {
      method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(15000), ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new ApiError(response.status, typeof data?.detail === 'string' ? data.detail : `Server: ${response.status}`)
    }
    return response
  }
  async json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    return (await this.request(path, method, body)).json() as Promise<T>
  }
}

export function encode(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 0x8000) result += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(result)
}
export const decode = (content: string): Uint8Array => Uint8Array.from(atob(content), c => c.charCodeAt(0))
