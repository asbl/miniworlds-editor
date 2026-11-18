import { describe, expect, it } from 'vitest'
import { MemoryFs } from '../workspace'
import { EmbedBridge, type BridgeEvent, type BridgeWindow } from './bridge'
import { collectFiles, replaceFiles } from './files'
import { observeFs } from './observedFs'
import { APP, EmbedError, decodeContent, encodeFile, parseIncoming, type Incoming } from './protocol'

const msg = (m: object) => ({ app: APP, ...m })

describe('embed protocol', () => {
  it('ignores messages that are not for the editor', () => {
    expect(parseIncoming(null)).toBeNull()
    expect(parseIncoming('load')).toBeNull()
    expect(parseIncoming({ type: 'load', files: {} })).toBeNull() // other scripts post messages too
    expect(parseIncoming(msg({ type: 'unknown' }))).toBeNull()
  })
  it('reads load and get-files', () => {
    expect(parseIncoming(msg({ type: 'get-files', id: 'a' }))).toEqual({ type: 'get-files', id: 'a' })
    expect(parseIncoming(msg({ type: 'load', files: { 'main.py': 'x', './classes//A.py': 'y', 'images/a.png': { base64: 'AA==' } }, lang: 'en', mode: 'miniworlds' }))).toEqual({
      type: 'load',
      id: undefined,
      files: { 'main.py': 'x', 'classes/A.py': 'y', 'images/a.png': { base64: 'AA==' } },
      lang: 'en',
      mode: 'miniworlds',
    })
  })
  it('refuses unsafe or malformed loads', () => {
    expect(() => parseIncoming(msg({ type: 'load', files: { '../x.py': '' } }))).toThrow(EmbedError)
    expect(() => parseIncoming(msg({ type: 'load', files: { 'a/../../x.py': '' } }))).toThrow(EmbedError)
    expect(() => parseIncoming(msg({ type: 'load', files: [] }))).toThrow(EmbedError)
    expect(() => parseIncoming(msg({ type: 'load', files: { 'a.py': 5 } }))).toThrow(EmbedError)
    expect(() => parseIncoming(msg({ type: 'load', files: Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`f${i}.py`, ''])) }))).toThrow(/too many/)
  })
  it('round-trips text and binary content', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255])
    expect(encodeFile('main.py', new TextEncoder().encode('print("ä")'))).toBe('print("ä")')
    const encoded = encodeFile('images/a.png', png)
    expect(encoded).toEqual({ base64: expect.any(String) })
    expect(decodeContent(encoded)).toEqual(png)
    expect(encodeFile('data.py', Uint8Array.from([0xff, 0xfe]))).toEqual({ base64: '//4=' }) // invalid UTF-8 never goes out as text
  })
})

class FakeWindow implements BridgeWindow {
  sent: { message: Record<string, unknown>; origin: string }[] = []
  parent = { postMessage: (message: unknown, origin: string) => void this.sent.push({ message: message as Record<string, unknown>, origin }) }
  private listeners = new Set<(e: BridgeEvent) => void>()
  addEventListener(_: 'message', l: (e: BridgeEvent) => void) {
    this.listeners.add(l)
  }
  removeEventListener(_: 'message', l: (e: BridgeEvent) => void) {
    this.listeners.delete(l)
  }
  deliver(data: unknown, origin = 'https://moodle.example', source: unknown = this.parent) {
    this.listeners.forEach((l) => l({ data, origin, source }))
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('EmbedBridge', () => {
  it('announces itself and serves the embedding page', async () => {
    const win = new FakeWindow()
    const got: Incoming[] = []
    const bridge = new EmbedBridge(win, null, (m) => void got.push(m))
    bridge.start()
    expect(win.sent).toEqual([{ message: { app: APP, type: 'ready' }, origin: '*' }])
    win.deliver(msg({ type: 'get-files', id: '1' }))
    await tick()
    expect(got).toEqual([{ type: 'get-files', id: '1' }])
    bridge.send({ type: 'change', files: {} })
    expect(win.sent.at(-1)).toMatchObject({ origin: 'https://moodle.example' }) // answers go to the asker, never to "*"
  })
  it('holds back data until the page has spoken', () => {
    const win = new FakeWindow()
    const bridge = new EmbedBridge(win, null, () => {})
    bridge.start()
    bridge.send({ type: 'change', files: { 'main.py': 'secret' } })
    expect(win.sent).toHaveLength(1) // only "ready"
    expect(bridge.connected).toBe(false)
  })
  it('ignores other windows and, with a list, other origins', async () => {
    const win = new FakeWindow()
    const got: Incoming[] = []
    const bridge = new EmbedBridge(win, ['https://moodle.example'], (m) => void got.push(m))
    bridge.start()
    expect(win.sent[0]?.origin).toBe('https://moodle.example') // ready only to the listed origin
    win.deliver(msg({ type: 'get-files' }), 'https://moodle.example', {}) // another window
    win.deliver(msg({ type: 'get-files' }), 'https://evil.example')
    win.deliver(msg({ type: 'get-files' }), 'null')
    await tick()
    expect(got).toEqual([])
    win.deliver(msg({ type: 'get-files' }))
    await tick()
    expect(got).toHaveLength(1)
  })
  it('reports refused and failing messages', async () => {
    const win = new FakeWindow()
    const bridge = new EmbedBridge(win, null, () => {
      throw new Error('boom')
    })
    bridge.start()
    win.deliver(msg({ type: 'load', id: 'x', files: { '../a': '' } }))
    await tick()
    expect(win.sent.at(-1)?.message).toMatchObject({ type: 'error', id: 'x' })
    win.deliver(msg({ type: 'get-files', id: 'y' }))
    await tick()
    expect(win.sent.at(-1)?.message).toMatchObject({ type: 'error', id: 'y', message: 'boom' })
  })
  it('does nothing when not embedded', () => {
    const win = new FakeWindow()
    ;(win as { parent: unknown }).parent = win
    new EmbedBridge(win, null, () => {}).start()
    expect(win.sent).toEqual([])
  })
})

describe('embed files', () => {
  it('replaces the project and collects it again', async () => {
    const fs = new MemoryFs()
    await fs.write('old.py', 'x')
    await fs.write('main.py', 'old')
    await replaceFiles(fs, { 'main.py': 'new', 'classes/A.py': 'a', 'images/p.png': { base64: 'AAE=' } })
    expect(await fs.exists('old.py')).toBe(false)
    expect(await collectFiles(fs)).toEqual({ 'main.py': 'new', 'classes/A.py': 'a', 'images/p.png': { base64: 'AAE=' } })
  })
  it('reports writes through the observed file system', async () => {
    let changes = 0
    const fs = observeFs(new MemoryFs(), () => changes++)
    await fs.write('a.py', '1')
    await fs.rename('a.py', 'b.py')
    await fs.remove('b.py')
    await fs.list()
    expect(changes).toBe(3)
  })
})
