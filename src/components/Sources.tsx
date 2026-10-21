import { citationAnchor, pageLabel } from '../lib/citations'
import type { RankedChunk } from '../lib/types'
import { IconChevronRight, IconFileText } from './Icons'

interface SourcesProps {
  turnId: string
  sources: RankedChunk[]
  /** The standalone question used for retrieval when the user's text was rewritten. */
  retrievalQuery?: string
}

export function Sources({ turnId, sources, retrievalQuery }: SourcesProps) {
  if (sources.length === 0) return null

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-medium text-[var(--ui-text-muted)]">
        Sources · {sources.length} excerpt{sources.length === 1 ? '' : 's'}
        {retrievalQuery ? (
          <span className="font-normal text-[var(--ui-text-dimmed)]">
            {' '}
            · searched as “{retrievalQuery}”
          </span>
        ) : null}
      </p>
      {sources.map((s, i) => (
        <details
          key={s.id}
          id={citationAnchor(turnId, i + 1)}
          className="group scroll-mt-4 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] target:border-[var(--ui-primary)]"
        >
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-[var(--ui-text)] select-none [&::-webkit-details-marker]:hidden">
            <IconChevronRight
              size={12}
              className="shrink-0 text-[var(--ui-text-dimmed)] transition-transform group-open:rotate-90"
            />
            <IconFileText size={13} className="shrink-0 text-[var(--ui-text-dimmed)]" />
            <span className="min-w-0 flex-1 truncate font-medium">
              [{i + 1}] {s.documentName}
            </span>
            {pageLabel(s) ? (
              <span className="shrink-0 text-[10px] text-[var(--ui-text-dimmed)]">{pageLabel(s)}</span>
            ) : null}
            <span className="shrink-0 rounded-full bg-[var(--ui-bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ui-text-muted)]">
              {s.score.toFixed(3)}
            </span>
          </summary>
          <p className="border-t border-[var(--ui-border)] px-3 py-2.5 text-xs leading-relaxed text-[var(--ui-text-muted)]">
            {s.text}
          </p>
        </details>
      ))}
    </div>
  )
}
