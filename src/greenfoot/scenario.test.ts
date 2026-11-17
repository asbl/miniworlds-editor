import { describe, expect, it } from 'vitest'
import type { RpcReply } from '../runtime/protocol'
import { ScenarioClient, ScenarioError, speedFactor, speedLabel } from './scenario'

function fake(answers: Record<string, RpcReply>) {
  const calls: [string, unknown[]][] = []
  return {
    calls,
    runner: {
      rpc: async (name: string, ...args: unknown[]) => {
        calls.push([name, args])
        return (answers[name] ?? { ok: false, error: 'unknown' }) as RpcReply<never>
      },
    },
  }
}

describe('ScenarioClient', () => {
  it('prefixes commands and unwraps values', async () => {
    const { runner, calls } = fake({ 'scenario:place': { ok: true, value: 'h1' }, 'scenario:act': { ok: true, value: null } })
    const client = new ScenarioClient(runner)
    expect(await client.place('Krabbe', 10, 20, ['5'])).toBe('h1')
    await client.act()
    expect(calls).toEqual([
      ['scenario:place', ['Krabbe', 10, 20, ['5']]],
      ['scenario:act', [1]],
    ])
  })

  it('turns error replies into ScenarioError with the engine message', async () => {
    const { runner } = fake({ 'scenario:call': { ok: false, error: 'ValueError: Wert fehlt' } })
    const client = new ScenarioClient(runner)
    await expect(client.call('h', 'm', [])).rejects.toThrow(ScenarioError)
    await expect(client.call('h', 'm', [])).rejects.toThrow('Wert fehlt')
  })
})

describe('speed', () => {
  it('maps the slider to powers of two and clamps', () => {
    expect([-3, -1, 0, 1, 3].map(speedFactor)).toEqual([0.125, 0.5, 1, 2, 8])
    expect(speedFactor(9)).toBe(8)
    expect(speedFactor(-9)).toBe(0.125)
  })
  it('labels', () => {
    expect([-3, -1, 0, 2].map(speedLabel)).toEqual(['1/8×', '1/2×', '1×', '4×'])
  })
})
