import { t, useLang, type MessageKey } from '../i18n'
import { Menu, type MenuItem } from '../ui/Menu'
import blocks from './blocks.json'
import { GROUPS, type Block } from './insert'

const ALL = blocks as Block[]

/** Code of a block as a pupil reads it: the field defaults, no `${…}` markers. */
export const preview = (code: string) => code.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}/g, '…')

/** One button in the editor's tab bar: a list of ready-made pieces of code, grouped; a click puts one at the cursor. */
export function BlocksMenu({ onInsert }: { onInsert: (block: Block) => void }) {
  useLang()
  const items: MenuItem[] = GROUPS.flatMap((group) => [
    { label: t(`blockgroup.${group}` as MessageKey), heading: true, onSelect: () => {} },
    ...ALL.filter((b) => b.group === group).map((b) => ({ label: t(`block.${b.id}` as MessageKey), title: preview(b.code), onSelect: () => onInsert(b) })),
  ])
  return <Menu label={`＋ ${t('blocks.button')} ▾`} title={t('blocks.title')} items={items} align="right" />
}
