import type { RankedChunk } from '../lib/types'

interface SourcesProps {
  sources: RankedChunk[]
}

export function Sources({ sources }: SourcesProps) {
  if (sources.length === 0) return null

  return (
    <div className="mt-2 space-y-2 border-t border-[var(--color-line)] pt-2">
      <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-[var(--color-source)] uppercase">
        Excerpts used
      </p>
      {sources.map((s, i) => (
        <details
          key={s.id}
          className="rounded border border-[var(--color-line)] bg-[var(--color-ink)]/40 px-2.5 py-1.5"
        >
          <summary className="cursor-pointer text-xs text-[var(--color-fg-dim)]">
            [{i + 1}] {s.documentName}{' '}
            <span className="font-[family-name:var(--font-mono)] text-[var(--color-muted)]">
              cos {s.score.toFixed(3)}
            </span>
          </summary>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">{s.text}</p>
        </details>
      ))}
    </div>
  )
}
