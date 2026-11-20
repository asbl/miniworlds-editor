import { afterEach, expect, it, vi } from 'vitest'
import { withNetwork } from './network'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it('aborts stalled fetches at the deadline and clears its timer', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    signal = options.signal!
    signal.addEventListener('abort', () => reject(signal!.reason), { once: true })
  }))
  const request = withNetwork({ timeoutMs: 50 }, client => client.request({ url: 'https://example.test' }))
  const assertion = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
  await vi.advanceTimersByTimeAsync(50)
  await assertion
  expect(signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
it('rejects an already cancelled operation without starting a request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const controller = new AbortController(); controller.abort()
  await expect(withNetwork({ signal: controller.signal }, client => client.request({ url: 'https://example.test' }))).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetch).not.toHaveBeenCalled()
})
