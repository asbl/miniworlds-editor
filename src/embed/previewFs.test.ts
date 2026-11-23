import { expect, it } from 'vitest'
import { MemoryFs } from '../workspace'
import { previewFs } from './previewFs'
import { parseIncoming } from './protocol'

it('locks all mutation paths, including exclusive callbacks, while keeping a snapshot readable', async () => {
  const raw = new MemoryFs(); await raw.write('main.py', 'print(1)')
  let locked = true
  const fs = previewFs(raw, () => locked)
  expect(await fs.read('main.py')).toBe('print(1)')
  await fs.write('main.py', 'print(1)')
  await expect(fs.write('main.py', 'changed')).rejects.toThrow('schreibgeschützt')
  await expect(fs.remove('main.py')).rejects.toThrow('schreibgeschützt')
  await expect(fs.rename('main.py', 'other.py')).rejects.toThrow('schreibgeschützt')
  await expect(fs.exclusive!(inner => inner.write('new.py', 'bad'))).rejects.toThrow('schreibgeschützt')
  locked = false; await fs.write('main.py', 'editable again')
  expect(await raw.read('main.py')).toBe('editable again')
})
it('accepts only an explicit boolean preview flag', () => {
  expect(parseIncoming({app:'miniworlds-editor',type:'load',files:{'main.py':'x'},readOnly:true})).toMatchObject({readOnly:true})
  expect(parseIncoming({app:'miniworlds-editor',type:'load',files:{'main.py':'x'},readOnly:'false'})).not.toHaveProperty('readOnly')
})
