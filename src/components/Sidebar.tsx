import { useEffect, useMemo, useRef, useState } from 'react'
import { MODEL_OPTIONS, type ModelOptionId } from '../lib/models'
import type { ChatSession, ModelPhase } from '../lib/types'
import { IconFileText, IconPlus, IconSearch, IconSidebar, IconTrash, Logo } from './Icons'

export interface SidebarStatusInfo {
  phase: ModelPhase
  modelSwitching: boolean
  adapterName?: string
  vramMb?: number
  vramKnown: boolean
  modelId: ModelOptionId
  documentCount: number
  chunkCount: number
}

interface SidebarProps {
  chats: ChatSession[]
  activeId: string | null
  docCounts: Record<string, number>
  busy: boolean
  status: SidebarStatusInfo
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (chat: ChatSession) => void
  onCollapse: () => void
}

interface ChatGroup {
  label: string
  chats: ChatSession[]
}

function groupChats(chats: ChatSession[]): ChatGroup[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  const groups: ChatGroup[] = [
    { label: 'Today', chats: [] },
    { label: 'Yesterday', chats: [] },
    { label: 'Last 7 days', chats: [] },
    { label: 'Last 30 days', chats: [] },
    { label: 'Older', chats: [] },
  ]
  for (const chat of chats) {
    const t = chat.updatedAt
    if (t >= startOfToday) groups[0]!.chats.push(chat)
    else if (t >= startOfToday - day) groups[1]!.chats.push(chat)
    else if (t >= startOfToday - 7 * day) groups[2]!.chats.push(chat)
    else if (t >= startOfToday - 30 * day) groups[3]!.chats.push(chat)
    else groups[4]!.chats.push(chat)
  }
  return groups.filter((g) => g.chats.length > 0)
}

export function Sidebar({
  chats,
  activeId,
  docCounts,
  busy,
  status,
  onSelect,
  onNew,
  onDelete,
  onCollapse,
}: SidebarProps) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K focuses chat search, like the template's search shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((c) => c.title.toLowerCase().includes(q))
  }, [chats, query])

  const groups = useMemo(() => groupChats(filtered), [filtered])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <a
          href="/"
          onClick={(e) => e.preventDefault()}
          className="flex items-center gap-2 text-[var(--ui-text-highlighted)]"
        >
          <Logo size={20} className="text-[var(--ui-primary)]" />
          <span className="text-sm font-semibold">LocalAI</span>
        </a>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          className="rounded-lg p-1.5 text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)]"
        >
          <IconSidebar size={16} />
        </button>
      </div>

      <div className="shrink-0 space-y-1.5 px-3 pb-2">
        <button
          type="button"
          disabled={busy}
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg bg-[var(--ui-primary)] px-3 py-2 text-sm font-medium text-[var(--ui-text-inverted)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--ui-bg)]"
        >
          <IconPlus size={15} />
          New chat
        </button>

        <div className="relative">
          <IconSearch
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-lg border border-transparent bg-[var(--ui-bg-elevated)] py-1.5 pr-12 pl-8 text-sm text-[var(--ui-text)] outline-none transition-colors placeholder:text-[var(--ui-text-dimmed)] focus:border-[var(--ui-border-accented)]"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-[var(--ui-border)] bg-[var(--ui-bg)] px-1 font-mono text-[10px] text-[var(--ui-text-dimmed)]">
            {navigator.platform.toLowerCase().includes('mac') ? '⌘K' : 'Ctrl K'}
          </kbd>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--ui-text-dimmed)]">
            {query ? 'No chats match your search.' : 'No chats yet.'}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mt-3 first:mt-1">
              <p className="px-2 pb-1 text-[11px] font-semibold text-[var(--ui-text-dimmed)]">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.chats.map((chat) => {
                  const active = chat.id === activeId
                  const pdfs = docCounts[chat.id] ?? 0
                  return (
                    <li key={chat.id} className="group relative">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSelect(chat.id)}
                        title={`${chat.title} · ${new Date(chat.updatedAt).toLocaleString()} · ${chat.turns.length} message${chat.turns.length === 1 ? '' : 's'}`}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50 ${
                          active
                            ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text-highlighted)]'
                            : 'text-[var(--ui-text)] hover:bg-[var(--ui-bg-elevated)]'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                        {pdfs > 0 ? (
                          <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--ui-text-dimmed)] group-hover:opacity-0">
                            <IconFileText size={11} />
                            {pdfs}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(chat)}
                        aria-label={`Delete chat ${chat.title}`}
                        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-[var(--ui-text-dimmed)] opacity-0 transition-colors group-hover:opacity-100 hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-error)] focus-visible:opacity-100"
                      >
                        <IconTrash size={13} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
      </nav>

      <SidebarStatus status={status} />
    </div>
  )
}

function SidebarStatus({ status }: { status: SidebarStatusInfo }) {
  const {
    phase,
    modelSwitching,
    adapterName,
    vramMb,
    vramKnown,
    modelId,
    documentCount,
    chunkCount,
  } = status

  const loading = phase === 'loading-llm' || phase === 'loading-embed' || modelSwitching
  const label = modelSwitching
    ? 'Switching model'
    : phase === 'ready'
      ? 'Models ready'
      : phase === 'loading-llm'
        ? 'Loading model'
        : phase === 'loading-embed'
          ? 'Loading embeddings'
          : phase === 'error'
            ? 'Model error'
            : 'Waiting'
  const dot =
    phase === 'error'
      ? 'bg-[var(--ui-error)]'
      : loading
        ? 'animate-pulse bg-[var(--ui-warning)]'
        : phase === 'ready'
          ? 'bg-[var(--ui-success)]'
          : 'bg-[var(--ui-text-dimmed)]'

  return (
    <div className="shrink-0 border-t border-[var(--ui-border)] px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--ui-text)]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        {label}
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-[var(--ui-text-dimmed)]">
        {MODEL_OPTIONS[modelId].label}
        {adapterName ? ` · ${adapterName}` : ''}
        {vramKnown && vramMb != null ? ` · ~${(vramMb / 1024).toFixed(1)} GB` : ''}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-[var(--ui-text-dimmed)]">
        {documentCount} doc{documentCount === 1 ? '' : 's'} · {chunkCount} chunks · on-device
      </p>
    </div>
  )
}
