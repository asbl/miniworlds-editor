import type { Fs, ProjectStore, Workspace } from '../workspace'
import { withLock, exclusiveFs } from '../workspace/locked'
import { normalizePath } from '../workspace/types'
import { BackendClient, ApiError, encode, decode, type RemoteProject } from './client'

interface RecordData {
  id: number; revision: number; dirty: boolean; project: RemoteProject
  answerDrafts?: Record<string, { answers: Record<string, { checked: boolean }>; base_version: number }>
}
const hasDraft = (data: RecordData) => data.dirty || Object.keys(data.answerDrafts ?? {}).length > 0
export type SyncStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'login' | 'readonly'
const prefix = (base: string) => `miniworlds-backend:${base}:`

/** Project files remain in the ordinary local store, so failed saves survive a reload and can always be exported. */
export class BackendProjects {
  private connections = new Map<string, BackendConnection>()
  constructor(readonly store: ProjectStore, readonly base: string, private meta: Storage = localStorage, private secrets: Storage = sessionStorage) {}
  key(name: string) { return `${prefix(this.base)}${name}` }
  async open(name: string, workspace: Workspace): Promise<BackendConnection | null> {
    if (this.connections.has(name)) return this.connections.get(name)!
    const value = this.meta.getItem(this.key(name))
    if (!value) return null
    const data = JSON.parse(value) as RecordData
    const client = new BackendClient(this.base, this.secrets.getItem(this.key(name)))
    const connection = new BackendConnection(name, workspace, client, data, this.meta, this.key(name))
    this.connections.set(name, connection)
    return connection
  }
  async claim(code: string, password: string): Promise<{ name: string; personalCode: string | null }> {
    const client = new BackendClient(this.base)
    const result = await client.json<{ token: string; project_id: number; personal_code: string | null }>('/api/claim', 'POST', { code, password })
    return this.bindToken(result)
  }
  /** Instead of a code: a short-lived assertion from the LTI service (`docs/lti.md`). Same answer as `/claim`. */
  async claimExternal(assertion: string): Promise<{ name: string; personalCode: string | null }> {
    const client = new BackendClient(this.base)
    const result = await client.json<{ token: string; project_id: number; personal_code: string | null }>('/api/play/lti-bind', 'POST', { assertion })
    return this.bindToken(result)
  }
  async openProject(connection: BackendConnection, id: number) {
    const result = await connection.client.json<{token:string;project_id:number}>(`/api/play/projects/${id}/open`, 'POST', {})
    return this.bindToken(result)
  }
  async createProject(connection: BackendConnection, title: string) {
    const result = await connection.client.json<{token:string;project_id:number}>('/api/play/projects', 'POST', {title})
    return this.bindToken(result)
  }
  private async bindToken(result: {token:string;project_id:number;personal_code?:string|null}) {
    const client = new BackendClient(this.base, result.token)
    // Store the token before fetching: a consumed template code cannot be redeemed again after a network interruption.
    let name: string | undefined
    for (const key of Object.keys(this.meta).filter(k => k.startsWith(prefix(this.base)))) {
      try {
        if ((JSON.parse(this.meta.getItem(key)!) as RecordData).id === result.project_id) name = key.slice(prefix(this.base).length)
      } catch { /* unrelated or damaged metadata */ }
    }
    if (!name) {
      const key = Object.keys(this.secrets).find(k => k.startsWith(prefix(this.base)) && k.endsWith(':project-id') && this.secrets.getItem(k) === String(result.project_id))
      if (key) name = key.slice(prefix(this.base).length, -':project-id'.length)
    }
    if (!name) {
      const base = `Server-Projekt ${result.project_id}`
      name = base
      for (let n = 2; await this.store.exists(name); n++) name = `${base} (${n})`
    }
    this.secrets.setItem(`${this.key(name)}:project-id`, String(result.project_id))
    this.secrets.setItem(this.key(name), result.token)
    if (result.personal_code) this.secrets.setItem(`${this.key(name)}:new-code`, result.personal_code)
    await this.attach(name, client)
    return { name, personalCode: result.personal_code ?? null }
  }
  /** Resume the token saved before an interrupted first download. */
  async resume(name: string) {
    const token = this.secrets.getItem(this.key(name))
    if (!token) throw new ApiError(401, 'Bitte den Projektcode erneut eingeben.')
    return this.attach(name, new BackendClient(this.base, token))
  }
  private async attach(name: string, client: BackendClient) {
    const workspace = await this.store.open(name)
    await withLock(this.key(name), async () => {
      const project = await client.json<RemoteProject>('/api/play/project')
      const raw = this.meta.getItem(this.key(name))
      const old = raw ? JSON.parse(raw) as RecordData : null
      if (!old || !hasDraft(old)) {
        const files: Record<string, Uint8Array> = {}
        for (const [path, content] of Object.entries(project.save?.files ?? {})) {
          if (normalizePath(path) !== path) throw new Error('Ungültiger Projektpfad')
          files[path] = decode(content)
        }
        if (!project.save?.files) files['main.py'] = new TextEncoder().encode(project.save?.source ?? '')
        if (project.save?.db) files['save.db'] = decode(project.save.db)
        for (const asset of project.save?.files ? [] : project.media) {
          const path = asset.filename ?? asset.orig_name.replace(/[^\w.\-]/g, '_')
          if (normalizePath(path) !== path) throw new Error('Ungültiger Medienpfad')
          if (!(path in files)) files[path] = new Uint8Array(await (await client.request(`/api/play/media/${asset.id}/file`)).arrayBuffer())
        }
        await exclusiveFs(workspace.fs, async fs => {
          for (const entry of await fs.list()) if (entry.kind === 'file' && !(entry.path in files)) await fs.remove(entry.path)
          for (const [path, bytes] of Object.entries(files)) await fs.write(path, bytes)
        })
        this.meta.setItem(this.key(name), JSON.stringify({ id: project.project_id, revision: project.revision, dirty: false, project: { ...project, save: null } } satisfies RecordData))
      } else {
        // Keep the revision of the draft. A changed server will yield a conflict instead of overwriting either side.
        this.meta.setItem(this.key(name), JSON.stringify({ ...old, project: { ...project, save: null } }))
      }
    })
    this.connections.get(name)?.dispose()
    this.connections.delete(name)
    return this.open(name, workspace)
  }
  private records(): string[] {
    return Object.keys(this.meta).filter(k => k.startsWith(prefix(this.base)) && !k.endsWith(':seen')).map(k => k.slice(prefix(this.base).length))
  }
  /** Names of local projects that are copies of server projects. */
  serverNames(): string[] { return this.records() }
  /** Mark the project as in use; a second tab of the same browser must not sweep it away. */
  touch(name: string) { try { this.meta.setItem(`${this.key(name)}:seen`, String(Date.now())) } catch { /* storage full or blocked */ } }
  /**
   * A new browser session has no token. A server copy without unsaved work is then just a stale copy (shared computers!):
   * remove it. Copies with a draft stay, so nothing is ever lost. Copies a different tab touched recently stay too.
   */
  async sweep(now = Date.now()): Promise<string[]> {
    const removed: string[] = []
    for (const name of this.records()) {
      try {
        const data = JSON.parse(this.meta.getItem(this.key(name))!) as RecordData
        const seen = Number(this.meta.getItem(`${this.key(name)}:seen`) ?? 0)
        if (this.secrets.getItem(this.key(name)) || hasDraft(data) || this.connections.has(name) || now - seen < 120_000) continue
        this.meta.removeItem(this.key(name)); this.meta.removeItem(`${this.key(name)}:seen`)
        await this.store.remove(name)
        removed.push(name)
      } catch { /* damaged record: leave it alone */ }
    }
    return removed
  }
  /** Local projects (not server copies) that could be moved into a server project. */
  async importCandidates(current: string): Promise<string[]> {
    const server = new Set(this.records())
    return (await this.store.list()).filter(n => n !== current && !server.has(n))
  }
  /** Replace the contents of a server project with those of a local project; the normal save then uploads them. */
  async importLocal(connection: BackendConnection, localName: string) {
    const source = await this.store.open(localName)
    const files = (await source.fs.list()).filter(e => e.kind === 'file')
    const target = connection.workspace.fs
    const keep = new Set(files.map(f => f.path))
    for (const entry of await target.list()) if (entry.kind === 'file' && !keep.has(entry.path)) await target.remove(entry.path)
    for (const file of files) await target.write(file.path, await source.fs.readBytes(file.path))
    await connection.sync()
  }
  /** A server version is newer than the unsaved draft: keep the draft as a separate local project, then take the server version. */
  async takeServer(connection: BackendConnection): Promise<string> {
    const stamp = new Date(), two = (n: number) => String(n).padStart(2, '0')
    const base = `${connection.project.title.slice(0, 35)} (Entwurf ${two(stamp.getDate())}.${two(stamp.getMonth() + 1)}. ${two(stamp.getHours())}.${two(stamp.getMinutes())})`
    let copy = base
    for (let n = 2; await this.store.exists(copy); n++) copy = `${base} ${n}`
    const target = await this.store.open(copy)
    for (const entry of await connection.local.fs.list()) {
      if (entry.kind === 'file') await target.fs.write(entry.path, await connection.local.fs.readBytes(entry.path))
    }
    await connection.discardDraft()
    await this.attach(connection.name, connection.client)
    return copy
  }
  pendingCodes(): { name: string; code: string }[] {
    return Object.keys(this.secrets).filter(k => k.startsWith(prefix(this.base)) && k.endsWith(':new-code'))
      .map(k => ({ name: k.slice(prefix(this.base).length, -':new-code'.length), code: this.secrets.getItem(k)! }))
  }
  acknowledgeCode(name: string) { this.secrets.removeItem(`${this.key(name)}:new-code`) }
  setToken(connection: BackendConnection, token: string) { connection.client.token = token; this.secrets.setItem(this.key(connection.name), token) }
  async logout(connection: BackendConnection) {
    connection.dispose()
    this.secrets.removeItem(this.key(connection.name))
    this.secrets.removeItem(`${this.key(connection.name)}:project-id`)
    this.acknowledgeCode(connection.name)
    this.meta.removeItem(this.key(connection.name))
    this.meta.removeItem(`${this.key(connection.name)}:seen`)
    this.secrets.removeItem(`${this.key(connection.name)}:offered`)
    this.connections.delete(connection.name)
    await this.store.remove(connection.name)
  }
}

export class BackendConnection {
  readonly workspace: Workspace
  status: SyncStatus
  error = ''
  private listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private blocked = false
  private lockKey: string
  constructor(readonly name: string, readonly local: Workspace, readonly client: BackendClient,
    private data: RecordData, private meta: Storage, private key: string) {
    this.lockKey = key
    this.status = !client.token ? 'login' : data.project.read_only ? 'readonly' : hasDraft(data) ? 'pending' : 'saved'
    const connection = this
    this.workspace = { ...local, kind: local.kind, fs: this.observe(local.fs), get readOnly() { return connection.project.read_only } }
    if (hasDraft(data) && client.token) this.schedule()
  }
  get project() {
    return { ...this.data.project, tasks: this.data.project.tasks.map(task => ({ ...task,
      answers: this.data.answerDrafts?.[task.assignment_id]?.answers ?? task.answers,
    })) }
  }
  get revision() { return this.load().revision }
  get dirty() { return hasDraft(this.load()) }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(status: SyncStatus, error = '') { this.status = status; this.error = error; this.listeners.forEach(f => f()) }
  private load() { this.data = JSON.parse(this.meta.getItem(this.key) ?? JSON.stringify(this.data)) as RecordData; return this.data }
  private persist() { this.meta.setItem(this.key, JSON.stringify(this.data)) }
  private observe(raw: Fs, inside = false): Fs {
    const mutate = async (action: () => Promise<void>) => {
      const perform = async () => {
        if (this.disposed) throw new Error('Abgemeldet')
        this.load()
        if (this.project.read_only) throw new Error(this.project.read_only_reason ?? 'Schreibgeschützt')
        this.data.dirty = true
        this.persist() // before writing: even an interrupted write is treated as an unsaved draft
        await action()
        if (!this.blocked) this.emit('pending')
        this.schedule()
      }
      return inside ? perform() : withLock(this.lockKey, perform)
    }
    return {
      list: () => raw.list(), read: p => raw.read(p), readBytes: p => raw.readBytes(p), exists: p => raw.exists(p),
      write: async (p, c) => {
        // Metadata hooks may write the same contents even in a read-only project.
        const bytes = typeof c === 'string' ? new TextEncoder().encode(c) : c
        if (await raw.exists(p)) { const old = await raw.readBytes(p); if (old.length === bytes.length && old.every((b, i) => b === bytes[i])) return }
        return mutate(() => raw.write(p, c))
      },
      remove: p => mutate(() => raw.remove(p)), rename: (a, b) => mutate(() => raw.rename(a, b)),
      exclusive: action => withLock(this.lockKey, () => exclusiveFs(raw, fs => action(this.observe(fs, true)))),
    }
  }
  private schedule() {
    clearTimeout(this.timer)
    if (!this.blocked && !this.disposed) this.timer = setTimeout(() => { void this.sync() }, 1500)
  }
  async sync(): Promise<void> {
    clearTimeout(this.timer)
    if (this.disposed || this.blocked) return
    await withLock(this.lockKey, async () => {
      this.load()
      if (!hasDraft(this.data)) return
      if (!this.client.token) { this.emit('login'); return }
      this.emit('saving')
      try {
        if (this.data.dirty) {
          const files = await exclusiveFs(this.local.fs, async fs => {
            const result: Record<string, string> = {}
            for (const entry of await fs.list()) if (entry.kind === 'file') result[entry.path] = encode(await fs.readBytes(entry.path))
            return result
          })
          const result = await this.client.json<{ revision: number }>('/api/play/save', 'PUT', {
            source: files['main.py'] ? new TextDecoder().decode(decode(files['main.py'])) : '', db: files['save.db'] ?? null,
            files, base_revision: this.data.revision,
          })
          this.data.revision = result.revision
          this.data.dirty = false
          this.persist()
        }
        for (const [id, draft] of Object.entries(this.data.answerDrafts ?? {})) {
          const result = await this.client.json<{ version: number }>(`/api/play/tasks/${id}/answers`, 'PUT', draft)
          const task = this.data.project.tasks.find(t => t.assignment_id === Number(id))
          if (task) { task.answers = draft.answers; task.version = result.version }
          delete this.data.answerDrafts![id]
          this.persist()
        }
        this.emit('saved')
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0
        if ([401, 403, 409, 413, 422].includes(status)) this.blocked = true
        this.emit(status === 409 ? 'conflict' : status === 401 ? 'login' : 'offline', error instanceof Error ? error.message : String(error))
        // Transient failures retry; authorization and conflicts require an explicit action.
        if (!this.blocked && !this.disposed) this.timer = setTimeout(() => { void this.sync() }, 15000)
      }
    })
  }
  async retry() { this.blocked = false; await this.sync() }
  /** Is the server ahead of us (another device saved)? "newer" = nothing unsaved here, so the server version can simply be loaded. */
  async checkRemote(): Promise<'same' | 'newer' | 'conflict'> {
    if (this.disposed || !this.client.token || this.status === 'saving') return 'same'
    try {
      const remote = await this.client.json<RemoteProject>('/api/play/project')
      return await withLock(this.lockKey, async () => {
        this.load()
        if (this.disposed || remote.revision === this.data.revision) return 'same'
        if (!this.data.dirty) return hasDraft(this.data) ? 'same' : 'newer'
        this.blocked = true
        this.emit('conflict', 'Auf einem anderen Gerät wurde inzwischen gespeichert.')
        return 'conflict'
      })
    } catch { return 'same' } // offline or signed out: the normal save reports that
  }
  /** Keep this draft: adopt the server's revision, so the next save replaces it (the server keeps its history). */
  async keepLocal() {
    const remote = await this.client.json<RemoteProject>('/api/play/project')
    await withLock(this.lockKey, async () => { this.load(); this.data.revision = remote.revision; this.persist() })
    await this.retry()
  }
  async discardDraft() {
    await withLock(this.lockKey, async () => { this.load(); this.data.dirty = false; delete this.data.answerDrafts; this.persist() })
  }
  async answer(assignment: number, item: number, checked: boolean) {
    await withLock(this.lockKey, async () => {
      this.load()
      const task = this.project.tasks.find(t => t.assignment_id === assignment)
      if (!task || this.project.read_only || task.status === 'submitted') throw new Error('Aufgabe ist nicht bearbeitbar.')
      this.data.answerDrafts ??= {}
      const old = this.data.answerDrafts[assignment]
      this.data.answerDrafts[assignment] = { base_version: old?.base_version ?? task.version,
        answers: { ...task.answers, [item]: { checked } } }
      this.persist()
      this.emit('pending')
    })
    await this.sync()
  }
  async refreshTasks() {
    const project = await this.client.json<RemoteProject>('/api/play/project')
    await withLock(this.lockKey, async () => {
      this.load()
      this.data.project = { ...project, save: null }
      this.persist()
    })
    this.listeners.forEach(f => f())
  }
  dispose() { this.disposed = true; clearTimeout(this.timer) }
}
