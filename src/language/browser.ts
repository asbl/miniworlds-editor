import { PYODIDE_BASE } from '../runtime/config'
import { LanguageService, type LanguageWorkerLike } from './service'

export function createBrowserLanguageService(pyodideBase: string = PYODIDE_BASE, lowMemory = false): LanguageService {
  const service = new LanguageService({
    pyodideBase,
    createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as LanguageWorkerLike,
  })
  service.setLazy(lowMemory)
  return service
}
