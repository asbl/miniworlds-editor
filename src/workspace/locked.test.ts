import { expect, it } from 'vitest'
import { LockedFs } from './locked'
import { MemoryFs } from './memory'

it('serializes another project writer through the whole replacement transaction', async () => {
  const raw = new MemoryFs()
  const first = new LockedFs(raw, 'test-shared-project')
  const second = new LockedFs(raw, 'test-shared-project')
  let entered!: () => void; let release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const paused = new Promise<void>(resolve => { release = resolve })
  const events: string[] = []
  const transaction = first.exclusive(async fs => {
    await fs.write('main.py', 'old'); entered(); await paused
    await fs.write('main.py', 'pulled'); events.push('pull applied')
  })
  await started
  const edit = second.write('main.py', 'new student work').then(() => events.push('edit saved'))
  await Promise.resolve()
  expect(events).toEqual([])
  release(); await transaction; await edit
  expect(events).toEqual(['pull applied', 'edit saved'])
  expect(await first.read('main.py')).toBe('new student work')
})
