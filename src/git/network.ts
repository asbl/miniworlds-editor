import http from 'isomorphic-git/http/web'

export interface GitOperationOptions { signal?: AbortSignal; timeoutMs?: number }
export const GIT_TIMEOUT_MS = 30_000

/** One deadline covers redirects, authentication retries and response streaming. */
export async function withNetwork<T>(options: GitOperationOptions, action: (client: typeof http, signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Git request timed out', 'TimeoutError')), options.timeoutMs ?? GIT_TIMEOUT_MS)
  try {
    controller.signal.throwIfAborted()
    const client: typeof http = { request: request => http.request({ ...request, signal: controller.signal }) }
    return await action(client, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
