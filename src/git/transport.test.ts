import 'fake-indexeddb/auto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { Repository } from './repository'
import { MemoryStore } from '../workspace/projects'

// Exercise the real browser HTTP transport against Git's own smart HTTP backend.
let root: string
let server: Server
let url: string
beforeAll(async () => {
  if (typeof navigator === 'undefined') Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
  root = await mkdtemp(join(tmpdir(), 'miniworlds-git-'))
  execFileSync('git', ['init', '--bare', '--initial-branch=main', join(root, 'game.git')])
  execFileSync('git', ['-C', join(root, 'game.git'), 'config', 'http.receivepack', 'true'])
  server = createServer((request, response) => {
    const address = new URL(request.url!, 'http://localhost')
    const child = spawn('git', ['http-backend'], { env: { ...process.env,
      GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: address.pathname,
      QUERY_STRING: address.search.slice(1), REQUEST_METHOD: request.method,
      CONTENT_TYPE: request.headers['content-type'] || '', REMOTE_USER: 'student',
    } })
    let headers = Buffer.alloc(0); let sentHeaders = false
    child.stdout.on('data', (data: Buffer) => {
      if (sentHeaders) { response.write(data); return }
      headers = Buffer.concat([headers, data])
      const end = headers.indexOf('\r\n\r\n')
      if (end < 0) return
      for (const line of headers.subarray(0, end).toString().split('\r\n')) {
        const colon = line.indexOf(':'); const key = line.slice(0, colon); const value = line.slice(colon + 1).trim()
        if (key.toLowerCase() === 'status') response.statusCode = Number(value.split(' ')[0])
        else response.setHeader(key, value)
      }
      sentHeaders = true; response.write(headers.subarray(end + 4))
    })
    child.stdout.on('end', () => response.end())
    child.on('error', () => { response.statusCode = 500; response.end() })
    request.pipe(child.stdin)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/game.git`
})
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
})

it('pushes, clones, pulls binary/deleted files and refuses divergent branches', async () => {
  const store = new MemoryStore()
  const author = { name: 'Student', email: 'student@example.test' }
  const credentials = { username: '', token: '' }
  const connection = { url, branch: 'main', proxy: '' }
  const first = await store.open('First')
  await first.fs.write('main.py', 'print(1)')
  const writer = await Repository.create(first, connection, false, credentials)
  await writer.commit('Initial', author)
  await writer.push(credentials)
  const second = await store.open('Second')
  const reader = await Repository.create(second, connection, true, credentials)
  expect(await second.fs.read('main.py')).toBe('print(1)')
  await first.fs.remove('main.py')
  await first.fs.write('images/a.png', new Uint8Array([0, 255, 123]))
  await writer.commit('Image replaces main', author)
  await writer.push(credentials)
  await reader.pull(credentials)
  expect(await second.fs.exists('main.py')).toBe(false)
  expect(await second.fs.readBytes('images/a.png')).toEqual(new Uint8Array([0, 255, 123]))
  expect(await reader.changes()).toEqual([])
  await second.fs.write('local.py', 'local')
  await reader.commit('Local commit', author)
  await first.fs.write('remote.py', 'remote')
  await writer.commit('Remote commit', author)
  await writer.push(credentials)
  await expect(reader.pull(credentials)).rejects.toThrow()
  expect(await second.fs.read('local.py')).toBe('local')
  expect(await second.fs.exists('remote.py')).toBe(false)
  expect(await reader.changes()).toEqual([])
  await expect(reader.push(credentials)).rejects.toThrow()

  const third = await store.open('Third')
  const unsupportedReader = await Repository.create(third, connection, true, credentials)
  const native = join(root, 'native')
  execFileSync('git', ['clone', join(root, 'game.git'), native])
  await symlink('remote.py', join(native, 'linked.py'))
  execFileSync('git', ['-C', native, 'add', 'linked.py'])
  execFileSync('git', ['-C', native, '-c', 'user.name=Student', '-c', 'user.email=student@example.test', 'commit', '-m', 'Unsupported symbolic link'])
  execFileSync('git', ['-C', native, 'push'])
  await expect(unsupportedReader.pull(credentials)).rejects.toThrow('Symbolic links')
  expect(await third.fs.exists('linked.py')).toBe(false)
  expect(await third.fs.read('remote.py')).toBe('remote')
  expect(await unsupportedReader.changes()).toEqual([])
}, 20000)

it('refuses a successful fetch if the project changed, then saves a binary recovery archive on retry', async () => {
  const name = `race-${crypto.randomUUID()}.git`
  execFileSync('git', ['init', '--bare', '--initial-branch=main', join(root, name)])
  execFileSync('git', ['-C', join(root, name), 'config', 'http.receivepack', 'true'])
  const store = new MemoryStore()
  const credentials = { username: '', token: '' }
  const author = { name: 'Student', email: 'student@example.test' }
  const connection = { url: url.replace('game.git', name), branch: 'main', proxy: '' }
  const first = await store.open('First')
  await first.fs.write('main.py', 'original')
  await first.fs.write('image.png', new Uint8Array([0, 255, 42]))
  const writer = await Repository.create(first, connection, false, credentials)
  await writer.commit('Initial', author); await writer.push(credentials)
  const second = await store.open('Second')
  const reader = await Repository.create(second, connection, true, credentials)
  await first.fs.write('main.py', 'remote update')
  await writer.commit('Update', author); await writer.push(credentials)
  const fetch = globalThis.fetch
  let changed = false
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
    if (!changed) {
      changed = true
      await second.fs.write('main.py', 'new student work')
      await second.fs.write('new.py', 'local file')
    }
    return fetch(...args)
  })
  try { await expect(reader.pull(credentials)).rejects.toThrow('Project changed during pull') }
  finally { spy.mockRestore() }
  expect(await second.fs.read('main.py')).toBe('new student work')
  expect(await second.fs.read('new.py')).toBe('local file')
  expect(await reader.changes()).toEqual(['main.py', 'new.py'])
  await second.fs.write('main.py', 'original'); await second.fs.remove('new.py')
  await reader.pull(credentials)
  expect(await second.fs.read('main.py')).toBe('remote update')
  const archive = unzipSync((await reader.recoveryArchive())!)
  expect(new TextDecoder().decode(archive['main.py'])).toBe('original')
  expect(archive['image.png']).toEqual(new Uint8Array([0, 255, 42]))
  expect(await reader.changes()).toEqual([])

  await first.fs.remove('main.py'); await first.fs.write('replacement.py', 'replacement')
  await writer.commit('Replace main', author); await writer.push(credentials)
  const historyWrite = second.history!.write.bind(second.history!)
  const noBackupSpace = vi.spyOn(second.history!, 'write').mockImplementation(async (path, bytes) => {
    if (path === 'git/pre-pull.zip') throw new Error('Backup quota exceeded')
    return historyWrite(path, bytes)
  })
  try { await expect(reader.pull(credentials)).rejects.toThrow('Backup quota exceeded') }
  finally { noBackupSpace.mockRestore() }
  expect(await second.fs.read('main.py')).toBe('remote update')
  expect(await second.fs.exists('replacement.py')).toBe(false)
  expect(await reader.changes()).toEqual([])

  // If both replacement and rollback are refused by storage, recovery still survives reopening.
  const raw = await second.fs.exclusive!(async raw => raw)
  const noProjectSpace = vi.spyOn(raw, 'write').mockRejectedValue(new Error('Project quota exceeded'))
  try { await expect(reader.pull(credentials)).rejects.toThrow('Project quota exceeded') }
  finally { noProjectSpace.mockRestore() }
  const reopened = await Repository.open(second)
  const recovery = unzipSync((await reopened!.recoveryArchive())!)
  expect(new TextDecoder().decode(recovery['main.py'])).toBe('remote update')
  expect(recovery['image.png']).toEqual(new Uint8Array([0, 255, 42]))
}, 20000)
