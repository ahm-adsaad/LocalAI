import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatTurn } from '../lib/types'
import { IconLoader } from './Icons'
import { Sources } from './Sources'

interface MessagesProps {
  turns: ChatTurn[]
  activity?: string | null
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
              ) : (
                <div className="prose-chat">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {t.streaming ? `${t.content} ▍` : t.content}
                  </ReactMarkdown>
                </div>
              )}
              {t.sources ? <Sources sources={t.sources} /> : null}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
