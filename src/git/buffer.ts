import { Buffer } from 'buffer'

// isomorphic-git's ESM entry also uses free Buffer references. Loaded only with Git.
if (typeof globalThis.Buffer === 'undefined') {
  Object.defineProperty(globalThis, 'Buffer', { value: Buffer, writable: true, configurable: true })
}
