import './buffer'
import LightningFS from '@isomorphic-git/lightning-fs'
import * as git from 'isomorphic-git'
import type http from 'isomorphic-git/http/web'
import { withNetwork, type GitOperationOptions } from './network'
import { exclusiveFs, withLock } from '../workspace/locked'
import { exportZip } from '../project/zip'
import type { Fs, Workspace } from '../workspace'
import { gitStorage } from './storage'

export interface Connection { url: string; branch: string; proxy: string }
export interface Credentials { username: string; token: string }
interface Config extends Connection { id: string }
const CONFIG = 'git/connection.json'
const DIR = '/repo'

export function validateConnection(connection: Connection): void {
  for (const raw of [connection.url, connection.proxy].filter(Boolean)) {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('HTTPS required')
    if (url.username || url.password || url.search || url.hash) throw new Error('Use a URL without credentials, query or fragment')
  }
  if (!connection.url) throw new Error('Repository URL required')
}

export class Repository {
  private constructor(private workspace: Workspace, private fs: LightningFS, readonly connection: Config) {}
  private get options() { return { fs: this.fs, dir: DIR } }
  private network(credentials: Credentials, client: typeof http) {
    return { ...this.options, http: client, corsProxy: this.connection.proxy,
      onAuth: () => ({ username: credentials.username || 'git', password: credentials.token }) }
  }
  static async open(workspace: Workspace): Promise<Repository | null> {
    if (!workspace.history || !(await workspace.history.exists(CONFIG))) return null
    const config: Config = JSON.parse(await workspace.history.read(CONFIG))
    return new Repository(workspace, new LightningFS('miniworlds-git-' + config.id, { db: gitStorage(workspace.history, config.id) }), config)
  }
  static async create(workspace: Workspace, connection: Connection, clone: boolean, credentials: Credentials, options: GitOperationOptions = {}): Promise<Repository> {
    validateConnection(connection)
    if (!workspace.history) throw new Error('Git storage unavailable')
    if (await workspace.history.exists(CONFIG)) throw new Error('Repository already connected')
    const config = { ...connection, id: crypto.randomUUID() }
    const storage = gitStorage(workspace.history, config.id)
    const repo = new Repository(workspace, new LightningFS('miniworlds-git-' + config.id, { db: storage }), config)
    try {
      await repo.fs.promises.mkdir(DIR)
      if (clone) {
        await withNetwork(options, async (client, signal) => {
          await git.clone({ ...repo.network(credentials, client), url: connection.url, ref: connection.branch || undefined, singleBranch: true })
          signal.throwIfAborted()
          await repo.checkoutToProject()
        })
      } else {
        await git.init({ ...repo.options, defaultBranch: connection.branch || 'main' })
        await git.addRemote({ ...repo.options, remote: 'origin', url: connection.url })
      }
      config.branch = await git.currentBranch(repo.options) || connection.branch || 'main'
      await repo.fs.promises.flush()
      await workspace.history.write(CONFIG, JSON.stringify(config))
      return repo
    } catch (error) {
      // Stop delayed LightningFS persistence before the failed clone's project is removed.
      await repo.fs.promises.flush().catch(() => {})
      storage.seal()
      await storage.wipe()
      throw error
    }
  }
  async updateConnection(url: string, proxy: string): Promise<void> {
    return this.operation(() => this.saveConnection(url, proxy))
  }
  private async saveConnection(url: string, proxy: string): Promise<void> {
    const next = { ...this.connection, url, proxy }
    validateConnection(next)
    const config: Config = JSON.parse(await this.workspace.history!.read(CONFIG))
    await git.addRemote({ ...this.options, remote: 'origin', url, force: true })
    await git.setConfig({ ...this.options, path: 'http.corsProxy', value: proxy })
    await this.fs.promises.flush()
    await this.workspace.history!.write(CONFIG, JSON.stringify({ ...config, url, proxy }))
    Object.assign(this.connection, { url, proxy })
  }
  private async files(dir = DIR): Promise<string[]> {
    const result: string[] = []
    for (const name of await this.fs.promises.readdir(dir)) {
      if (dir === DIR && name === '.git') continue
      if (name.toLowerCase() === '.git') throw new Error('.git is reserved')
      const path = `${dir}/${name}`
      const stat = await this.fs.promises.lstat(path)
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported by the editor')
      if (stat.isDirectory()) result.push(...await this.files(path))
      else result.push(path.slice(DIR.length + 1))
    }
    return result
  }
  /** Copy saved editor content into the Git worktree, preserving .git. */
  async sync(project: Fs = this.workspace.fs): Promise<void> {
    const entries = (await project.list()).filter(e => e.kind === 'file')
    if (entries.some(e => e.path.split('/').some(p => p.toLowerCase() === '.git'))) throw new Error('.git is reserved')
    const paths = new Set(entries.map(e => e.path))
    for (const path of await this.files()) if (!paths.has(path)) await this.fs.promises.unlink(`${DIR}/${path}`)
    // Remove empty directories too, so renaming a directory to a file works.
    const prune = async (dir: string) => {
      for (const name of await this.fs.promises.readdir(dir)) {
        if (name === '.git') continue
        const path = `${dir}/${name}`
        if ((await this.fs.promises.lstat(path)).isDirectory()) { await prune(path); if (!(await this.fs.promises.readdir(path)).length) await this.fs.promises.rmdir(path) }
      }
    }
    await prune(DIR)
    for (const { path } of entries) {
      const parts = path.split('/'); parts.pop()
      let dir = DIR
      for (const part of parts) {
        dir += '/' + part
        try { await this.fs.promises.mkdir(dir) } catch (error) { if ((error as { code?: string }).code !== 'EEXIST') throw error }
      }
      await this.fs.promises.writeFile(`${DIR}/${path}`, await project.readBytes(path))
    }
  }
  private operation<T>(action: () => Promise<T>): Promise<T> { return withLock(`git-operation-${this.connection.id}`, action) }
  async changes(): Promise<string[]> {
    return this.operation(() => exclusiveFs(this.workspace.fs, fs => this.scanChanges(fs)))
  }
  private async scanChanges(fs: Fs): Promise<string[]> {
    await this.sync(fs)
    return (await git.statusMatrix(this.options)).filter(([, head, work]) => head !== work).map(([path]) => path)
  }
  async commit(message: string, author: { name: string; email: string }): Promise<string> {
    return this.operation(() => exclusiveFs(this.workspace.fs, fs => this.commitFiles(message, author, fs)))
  }
  private async commitFiles(message: string, author: { name: string; email: string }, fs: Fs): Promise<string> {
    if (!message.trim() || !author.name.trim() || !author.email.trim()) throw new Error('Commit message, name and email required')
    await this.sync(fs)
    const matrix = await git.statusMatrix(this.options)
    if (!matrix.some(([, head, work]) => head !== work)) throw new Error('No changes to commit')
    for (const [filepath, , work] of matrix) {
      if (work === 0) await git.remove({ ...this.options, filepath })
      else await git.add({ ...this.options, filepath })
    }
    const oid = await git.commit({ ...this.options, message, author })
    await this.fs.promises.flush()
    return oid
  }
  async pull(credentials: Credentials, options: GitOperationOptions = {}): Promise<void> {
    if (this.workspace.kind === 'opfs' && !navigator.locks) throw new Error('Git pull requires Web Locks support')
    return this.operation(async () => {
      const previous = await exclusiveFs(this.workspace.fs, async fs => {
        if ((await this.scanChanges(fs)).length) throw new Error('Commit local changes before pulling')
        return this.snapshot(fs)
      })
      const ref = await git.currentBranch({ ...this.options, fullname: true })
      const oid = await git.resolveRef({ ...this.options, ref: 'HEAD' })
      try {
        await withNetwork(options, async (client, signal) => {
          await git.fastForward({ ...this.network(credentials, client), singleBranch: true })
          signal.throwIfAborted()
          const incoming = await this.checkoutFiles()
          await exclusiveFs(this.workspace.fs, async fs => {
            signal.throwIfAborted()
            if (!this.sameFiles(previous, await this.snapshot(fs))) throw new Error('Project changed during pull; local changes were preserved')
            // Commit the binary recovery archive before the first destructive file operation.
            await this.workspace.history!.write('git/pre-pull.zip', await exportZip(fs))
            signal.throwIfAborted()
            try { await this.replaceProject(incoming, fs) }
            catch (error) {
              await this.replaceProject(previous, fs)
              throw error
            }
          })
        })
      } catch (error) {
        // Fetch errors and concurrent edits must never rewrite the project.
        if (ref) {
          await git.writeRef({ ...this.options, ref, value: oid, force: true })
          await git.checkout({ ...this.options, ref: ref.replace('refs/heads/', ''), force: true })
        }
        throw error
      } finally { await this.fs.promises.flush() }
    })
  }
  async push(credentials: Credentials, options: GitOperationOptions = {}): Promise<void> {
    return this.operation(() => withNetwork(options, async (client) => {
      const result = await git.push({ ...this.network(credentials, client), remote: 'origin', remoteRef: this.connection.branch || undefined })
      if (!result.ok) throw new Error(result.error || 'Push rejected')
    }))
  }
  async hasRecoveryArchive(): Promise<boolean> { return this.workspace.history!.exists('git/pre-pull.zip') }
  async recoveryArchive(): Promise<Uint8Array | null> {
    return await this.workspace.history!.exists('git/pre-pull.zip') ? this.workspace.history!.readBytes('git/pre-pull.zip') : null
  }
  private async snapshot(fs: Fs): Promise<{ path: string; bytes: Uint8Array }[]> {
    return Promise.all((await fs.list()).filter(e => e.kind === 'file').map(async e => ({ path: e.path, bytes: new Uint8Array(await fs.readBytes(e.path)) })))
  }
  private sameFiles(a: { path: string; bytes: Uint8Array }[], b: { path: string; bytes: Uint8Array }[]): boolean {
    const entries = new Map(b.map(f => [f.path, f.bytes]))
    return a.length === b.length && a.every(f => {
      const bytes = entries.get(f.path)
      return bytes?.length === f.bytes.length && f.bytes.every((value, i) => bytes[i] === value)
    })
  }
  private async checkoutToProject(): Promise<void> {
    const files = await this.checkoutFiles()
    await exclusiveFs(this.workspace.fs, fs => this.replaceProject(files, fs))
  }
  private async checkoutFiles(): Promise<{ path: string; bytes: Uint8Array }[]> {
    // Validate and read every file before touching the project (e.g. unsupported symlinks).
    return Promise.all((await this.files()).map(async path => ({ path, bytes: new Uint8Array(await this.fs.promises.readFile(`${DIR}/${path}`) as Uint8Array) })))
  }
  private async replaceProject(files: { path: string; bytes: Uint8Array }[], project: Fs): Promise<void> {
    const paths = new Set(files.map(f => f.path))
    for (const entry of await project.list()) if (entry.kind === 'file' && !paths.has(entry.path)) await project.remove(entry.path)
    const dirs = new Set<string>()
    for (const { path } of files) {
      const parts = path.split('/'); parts.pop()
      while (parts.length) { dirs.add(parts.join('/')); parts.pop() }
    }
    for (const entry of (await project.list()).sort((a, b) => b.path.length - a.path.length)) {
      if (entry.kind === 'dir' && !dirs.has(entry.path)) await project.remove(entry.path)
    }
    for (const file of files) await project.write(file.path, file.bytes)
  }
}
