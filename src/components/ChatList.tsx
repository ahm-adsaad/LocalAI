import type { ChatSession } from '../lib/types'

interface ChatListProps {
  chats: ChatSession[]
  activeId: string | null
  docCounts: Record<string, number>
  busy: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

function formatWhen(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function ChatList({
  chats,
  activeId,
  docCounts,
  busy,
  onSelect,
  onNew,
  onDelete,
}: ChatListProps) {
  return (
    <section className="mt-6 flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h2 className="font-[family-name:var(--font-display)] text-base text-[var(--color-fg)]">
          Chats
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={onNew}
          className="rounded border border-[var(--color-line)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-accent)] hover:border-[var(--color-accent-dim)] disabled:opacity-40"
        >
          New
        </button>
      </div>
      <p className="mb-2 shrink-0 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-muted)]">
        each chat has its own PDFs
      </p>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
        {chats.length === 0 ? (
          <li className="px-1 text-sm text-[var(--color-muted)]">No saved chats yet.</li>
        ) : (
          chats.map((chat) => {
            const active = chat.id === activeId
            const pdfs = docCounts[chat.id] ?? 0
            return (
              <li key={chat.id}>
                <div
                  className={`group flex items-start gap-1 rounded-md border px-2 py-1.5 ${
                    active
                      ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-dim)]/15'
                      : 'border-[var(--color-line)] bg-[var(--color-panel)]'
                  }`}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSelect(chat.id)}
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                  >
                    <p className="truncate text-sm text-[var(--color-fg)]">{chat.title}</p>
                    <p className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-muted)]">
                      {formatWhen(chat.updatedAt)} · {pdfs} pdf
                      {pdfs === 1 ? '' : 's'} · {chat.turns.length} msg
                      {chat.turns.length === 1 ? '' : 's'}
                    </p>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDelete(chat.id)}
                    className="shrink-0 pt-0.5 text-[10px] text-[var(--color-muted)] opacity-0 hover:text-[var(--color-danger)] group-hover:opacity-100"
                    aria-label={`Delete chat ${chat.title}`}
                  >
                    ✕
                  </button>
                </div>
              </li>
            )
          })
        )}
      </ul>
    </section>
  )
}
