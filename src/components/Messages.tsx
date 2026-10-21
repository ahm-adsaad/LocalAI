import { useEffect, useRef, type MouseEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { linkifyCitations, sourceTitle } from '../lib/citations'
import { formatTurnStats } from '../lib/stats'
import type { ChatTurn, ExtractedField } from '../lib/types'
import { IconLoader } from './Icons'
import { Sources } from './Sources'

interface MessagesProps {
  turns: ChatTurn[]
  activity?: string | null
}

/** Open and reveal the source card a citation link points at, without a page jump. */
function jumpToSource(e: MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  const el = document.getElementById(href.slice(1))
  if (!(el instanceof HTMLDetailsElement)) return
  el.open = true
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

const markdownComponents: Components = {
  a: ({ href, children, ...rest }) => {
    if (href?.startsWith('#src-')) {
      return (
        <a
          {...rest}
          href={href}
          onClick={(e) => jumpToSource(e, href)}
          className="mx-0.5 inline-block rounded bg-[var(--ui-bg-elevated)] px-1 font-mono text-[10px] text-[var(--ui-primary)] no-underline hover:underline"
        >
          {children}
        </a>
      )
    }
    return (
      <a {...rest} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
}

function ExtractionTable({ turnId, rows }: { turnId: string; rows: ExtractedField[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--ui-border)]">
      <table className="w-full text-xs">
        <thead className="bg-[var(--ui-bg-muted)] text-left text-[var(--ui-text-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="px-3 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-[var(--ui-border)]">
              <td className="px-3 py-2 font-medium text-[var(--ui-text-highlighted)]">{r.name}</td>
              <td className="px-3 py-2 text-[var(--ui-text)]">
                {r.value ?? <span className="text-[var(--ui-text-dimmed)]">not found</span>}
              </td>
              <td className="px-3 py-2">
                {r.source != null ? (
                  <a
                    href={`#src-${turnId}-${r.source}`}
                    onClick={(e) => jumpToSource(e, `#src-${turnId}-${r.source}`)}
                    className="rounded bg-[var(--ui-bg-elevated)] px-1 font-mono text-[10px] text-[var(--ui-primary)] hover:underline"
                  >
                    [{r.source}]
                  </a>
                ) : (
                  <span className="text-[var(--ui-text-dimmed)]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Messages({ turns, activity }: MessagesProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Scroll only the message pane — never the page (scrollIntoView can bubble up).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [turns])

  return (
    <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        {turns.map((t) =>
          t.role === 'user' ? (
            <div key={t.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--ui-bg-elevated)] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-[var(--ui-text-highlighted)]">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={t.id} className="text-sm text-[var(--ui-text)]">
              {t.streaming && !t.content ? (
                <span className="flex items-center gap-2 text-[var(--ui-text-muted)]">
                  <IconLoader size={14} />
                  {activity ?? 'Thinking…'}
                </span>
              ) : t.extraction ? (
                <ExtractionTable turnId={t.id} rows={t.extraction} />
              ) : (
                <div className="prose-chat">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {t.streaming
                      ? `${t.content} ▍`
                      : linkifyCitations(
                        t.content,
                        t.sources?.length ?? 0,
                        t.id,
                        t.sources?.map(sourceTitle),
                      )}
                  </ReactMarkdown>
                </div>
              )}
              {t.sources ? (
                <Sources turnId={t.id} sources={t.sources} retrievalQuery={t.retrievalQuery} />
              ) : null}
              {t.stats && !t.streaming ? (
                <p
                  className="mt-2 font-mono text-[10px] text-[var(--ui-text-dimmed)]"
                  title={`${t.stats.modelId} · ${t.stats.completionTokens} completion tokens · ${Math.round(t.stats.totalMs)} ms total`}
                >
                  {formatTurnStats(t.stats)}
                  {t.aborted ? ' · stopped' : ''}
                </p>
              ) : null}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
