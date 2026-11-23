import { APP, EmbedError, parseIncoming, type Incoming, type Outgoing } from './protocol'

/** The parts of `window` the bridge uses (a test double stands in for it in unit tests). */
export interface BridgeWindow {
  parent: BridgeTarget
  addEventListener(type: 'message', listener: (event: BridgeEvent) => void): void
  removeEventListener(type: 'message', listener: (event: BridgeEvent) => void): void
}
export interface BridgeTarget {
  postMessage(message: unknown, targetOrigin: string): void
}
export interface BridgeEvent {
  data: unknown
  origin: string
  source: unknown
}

/**
 * Talks to the page that embeds the editor. Safety rules:
 *  - only messages from the embedding window itself are read (not from other windows or tabs);
 *  - with an origin list in config.json only those origins are served; without one, any embedding page is;
 *  - data goes only to the origin that sent the last valid message (never "*"); before the first message only `ready` is sent,
 *    to the listed origins, or to "*" when there is no list (it carries no data).
 */
export class EmbedBridge {
  private peer: string | null = null
  private listener = (event: BridgeEvent) => void this.receive(event)

  constructor(
    private win: BridgeWindow,
    private allowed: string[] | null,
    private onMessage: (message: Incoming) => void | Promise<void>,
  ) {}

  get embedded(): boolean {
    return this.win.parent !== (this.win as unknown)
  }

  start(): void {
    if (!this.embedded) return
    this.win.addEventListener('message', this.listener)
    this.send({ type: 'ready', apiVersion: 1, capabilities: ['read-only-preview'] })
  }

  stop(): void {
    this.win.removeEventListener('message', this.listener)
  }

  /** Whether `change` messages can be sent yet (the page has to speak first, so we know who may read the files). */
  get connected(): boolean {
    return this.peer !== null
  }

  send(message: Outgoing): void {
    const body = { app: APP, ...message }
    if (this.peer) return this.win.parent.postMessage(body, this.peer)
    if (message.type !== 'ready') return
    for (const origin of this.allowed ?? ['*']) this.win.parent.postMessage(body, origin)
  }

  private async receive(event: BridgeEvent): Promise<void> {
    if (event.source !== this.win.parent) return
    if (event.origin === 'null' || (this.allowed && !this.allowed.includes(event.origin))) return
    let message: Incoming | null
    try {
      message = parseIncoming(event.data)
    } catch (error) {
      this.peer = event.origin
      const raw = event.data as { id?: unknown }
      this.send({ type: 'error', id: typeof raw?.id === 'string' ? raw.id : undefined, message: error instanceof EmbedError ? error.message : 'invalid message' })
      return
    }
    if (!message) return
    this.peer = event.origin
    try {
      await this.onMessage(message)
    } catch (error) {
      this.send({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) })
    }
  }
}
