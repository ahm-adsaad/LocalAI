import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatTurn } from '../lib/types'
import { Sources } from './Sources'

export type { ChatTurn }

interface ChatProps {
  turns: ChatTurn[]
  disabled: boolean
  placeholder?: string
  onSend: (text: string) => void
  onStop?: () => void
  onExport?: () => void
  generating?: boolean
  activity?: string | null
  title?: string
}

export function Chat({
  turns,
  disabled,
  placeholder = 'Ask about your documents…',
  onSend,
  onStop,
  onExport,
  generating,
  activity,
  title,
}: ChatProps) {
  const [draft, setDraft] = useState('')
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Scroll only the message pane — never the page (scrollIntoView can bubble up).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [turns])

  function submit(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || disabled || generating) return
    setDraft('')
    onSend(text)
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="mb-3 flex shrink-0 items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-[family-name:var(--font-display)] text-base text-[var(--color-fg)]">
            Ask
          </h2>
          {title ? (
            <p className="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-muted)]">
              {title}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onExport && turns.some((t) => !t.streaming && t.content.trim()) ? (
            <button
              type="button"
              disabled={generating}
              onClick={onExport}
              className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-accent)] hover:underline disabled:opacity-40"
            >
              Export
            </button>
          ) : null}
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-muted)]">
            {activity ?? 'retrieve → generate · on device'}
          </span>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]/40 p-3"
      >
        {turns.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-[var(--color-muted)]">
            Upload a PDF, then ask a question. Chats stay on this device — pick an older
            one from the sidebar anytime.
          </p>
        ) : (
          turns.map((t) => (
            <article
              key={t.id}
              className={`max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                t.role === 'user'
                  ? 'ml-auto bg-[var(--color-accent-dim)]/30 text-[var(--color-fg)]'
                  : 'mr-auto bg-[var(--color-ink-soft)] text-[var(--color-fg-dim)]'
              }`}
            >
              <p className="whitespace-pre-wrap">
                {t.content}
                {t.streaming ? (
                  <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-[var(--color-accent)] align-middle" />
                ) : null}
              </p>
              {t.sources ? <Sources sources={t.sources} /> : null}
            </article>
          ))
        )}
      </div>

      <form onSubmit={submit} className="mt-3 flex shrink-0 gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent-dim)]"
        />
        {generating ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-warn)] hover:border-[var(--color-warn)]"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || !draft.trim()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </section>
  )
}
