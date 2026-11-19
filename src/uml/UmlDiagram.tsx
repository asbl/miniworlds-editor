import { useMemo } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { attrText, layoutModel, methodText, STEREOTYPE } from './layout'
import type { ClassModel, Member, ModelClass } from './model'

export interface Marks {
  /** Last clicked in the diagram. */
  selected?: string | null
  /** The editor's cursor is inside this class. */
  cursor?: string | null
  /** The object selected in the world belongs to this class. */
  object?: string | null
  /** This class is armed for placing. */
  armed?: string | null
  /** An event method of this class was called a moment ago (see the trace). */
  fired?: ReadonlySet<string>
}

interface Props {
  model: ClassModel
  details: boolean
  /** Living objects per class name. */
  counts: Record<string, number>
  marks: Marks
  /** Changed since the world was started. */
  stale: ReadonlySet<string>
  /** Image URL per class name (shown in the box header). */
  images?: Record<string, string>
  onSelect: (info: ModelClass | null, name: string) => void
  onMember: (info: ModelClass, kind: 'attribute' | 'method', member: Member) => void
  onMenu: (event: MouseEvent, info: ModelClass | null, name: string) => void
}

/** The class diagram: boxes with attributes and methods, inheritance arrows, counters. Knows neither editor nor world. */
export function UmlDiagram({ model, details, counts, marks, stale, images = {}, onSelect, onMember, onMenu }: Props) {
  useLang()
  const layout = useMemo(() => layoutModel(model, details), [model, details])
  if (layout.nodes.length === 0) return <p class="uml-empty">{t('uml.empty')}</p>

  return (
    <div class="uml-canvas" style={{ width: `${layout.width}px`, height: `${layout.height}px` }}>
      <svg class="uml-edges" width={layout.width} height={layout.height} aria-hidden="true">
        {layout.edges.map((e, i) => (
          <g key={i}>
            <path d={e.path} class={e.secondary ? 'uml-edge secondary' : 'uml-edge'} />
            <path d={e.arrow} class="uml-arrow" />
          </g>
        ))}
      </svg>
      {layout.nodes.map((node) => {
        const info = node.lib ? null : (node.info as ModelClass)
        const count = counts[node.name]
        const classes = ['uml-box', node.kind, node.lib ? 'lib' : '', marks.selected === node.name ? 'is-selected' : '', marks.cursor === node.name ? 'is-cursor' : '', marks.object === node.name ? 'is-object' : '', marks.armed === node.name ? 'is-armed' : '', marks.fired?.has(node.name) ? 'is-fired' : '', stale.has(node.name) ? 'is-stale' : '']
        return (
          <div
            key={node.name}
            class={classes.filter(Boolean).join(' ')}
            role="group"
            aria-label={t('uml.class', { name: node.name })}
            style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.w}px`, minHeight: `${node.h}px` }}
            onContextMenu={(e) => (e.preventDefault(), onMenu(e, info, node.name))}
          >
            <button
              type="button"
              class="uml-head"
              title={info ? `${node.name} — ${info.file}, ${t('uml.line', { n: info.line })}` : `${node.name} (miniworlds)`}
              data-stale={stale.has(node.name) ? t('uml.stale') : undefined}
              onClick={() => onSelect(info, node.name)}
            >
              {info && images[node.name] && <img class="uml-img" src={images[node.name]} alt="" />}
              <span class="uml-stereo">{STEREOTYPE[node.kind]}</span>
              <span class="uml-name">{node.name}</span>
              {count ? (
                <span class="uml-count" aria-label={t('uml.objects')}>
                  {count}×
                </span>
              ) : null}
            </button>
            {info && details && (
              <>
                <ul class="uml-attrs">
                  {node.attrs.map((a) => (
                    <li key={a.name}>
                      <button type="button" class={a.static ? 'uml-item static' : 'uml-item'} title={`${a.name} — ${t('uml.line', { n: a.line })}`} onClick={() => onMember(info, 'attribute', a)}>
                        {attrText(a)}
                      </button>
                    </li>
                  ))}
                  {node.hiddenAttrs > 0 && <li class="uml-more">… +{node.hiddenAttrs}</li>}
                </ul>
                <ul class="uml-methods">
                  {node.methods.map((m) => (
                    <li key={m.name}>
                      <button type="button" class={m.kind === 'event' ? 'uml-item event' : 'uml-item'} title={`${m.name} — ${t('uml.line', { n: m.line })}`} onClick={() => onMember(info, 'method', m)}>
                        {methodText(m)}
                      </button>
                    </li>
                  ))}
                  {node.hiddenMethods > 0 && <li class="uml-more">… +{node.hiddenMethods}</li>}
                </ul>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
