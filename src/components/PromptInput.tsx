import { useRef, useState, type KeyboardEvent } from 'react'
import type { ModelOptionId } from '../lib/models'
import type { DocumentMeta } from '../lib/types'
import {
  IconArrowUp,
  IconFileText,
  IconLoader,
  IconPaperclip,
  IconStop,
  IconX,
} from './Icons'
import { ModelMenu } from './ModelMenu'

interface PromptInputProps {
  disabled: boolean
  generating?: boolean
  placeholder?: string
  onSend: (text: string) => void
  onStop?: () => void
  /* Per-chat PDF library, shown as attachments on the input card. */
  documents: DocumentMeta[]
  ingestBusy: boolean
  onUpload: (file: File) => void
  onDeleteDoc: (doc: DocumentMeta) => void
  onClearLibrary: () => void
  /* Model selection lives inside the input, like the template's ModelSelect. */
  modelId: ModelOptionId
  recommendedModel: ModelOptionId
  vramMb?: number
  vramKnown: boolean
  modelBusy: boolean
  onModelChange: (id: ModelOptionId) => void
}

export function PromptInput({
  disabled,
  generating,
  placeholder = 'Ask about your documents…',
  onSend,
  onStop,
  documents,
  ingestBusy,
  onUpload,
  onDeleteDoc,
  onClearLibrary,
  modelId,
  recommendedModel,
  vramMb,
  vramKnown,
  modelBusy,
  onModelChange,
}: PromptInputProps) {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function submit() {
    const text = draft.trim()
    if (!text || disabled || generating) return
    setDraft('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    onSend(text)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function autoGrow() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const canSend = !disabled && !generating && draft.trim().length > 0

  return (
    <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg)] shadow-sm transition-colors focus-within:border-[var(--ui-border-accented)]">
      {documents.length > 0 || ingestBusy ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--ui-border)] px-3 py-2">
          {documents.map((doc) => (
            <span
              key={doc.id}
              title={`${doc.name} · ${doc.pageCount} pages · ${doc.chunkCount} chunks`}
              className="group flex max-w-60 items-center gap-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] py-1 pr-1 pl-2 text-xs text-[var(--ui-text)]"
            >
              <IconFileText size={13} className="shrink-0 text-[var(--ui-text-dimmed)]" />
              <span className="min-w-0 truncate font-medium">{doc.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--ui-text-dimmed)]">
                {doc.pageCount}p
              </span>
              <button
                type="button"
                disabled={ingestBusy || generating}
                onClick={() => onDeleteDoc(doc)}
                aria-label={`Remove ${doc.name} from this chat`}
                className="shrink-0 rounded-md p-0.5 text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-error)] disabled:opacity-50"
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
          {ingestBusy ? (
            <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--ui-border-accented)] px-2 py-1 text-xs text-[var(--ui-text-muted)]">
              <IconLoader size={12} />
              Indexing…
            </span>
          ) : null}
          {documents.length > 1 ? (
            <button
              type="button"
              disabled={ingestBusy || generating}
              onClick={onClearLibrary}
              className="ml-auto text-[11px] font-medium text-[var(--ui-text-dimmed)] transition-colors hover:text-[var(--ui-error)] disabled:opacity-50"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value)
          autoGrow()
        }}
        onKeyDown={onKeyDown}
        className="max-h-50 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-relaxed text-[var(--ui-text-highlighted)] outline-none placeholder:text-[var(--ui-text-dimmed)] disabled:cursor-not-allowed"
      />

      <div className="flex items-center gap-1 px-2.5 pb-2.5">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={disabled || ingestBusy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          disabled={disabled || ingestBusy}
          onClick={() => fileRef.current?.click()}
          title="Add a PDF to this chat (or drop it anywhere)"
          aria-label="Add a PDF to this chat"
          className="rounded-lg p-2 text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconPaperclip size={15} />
        </button>

        <ModelMenu
          modelId={modelId}
          recommended={recommendedModel}
          vramMb={vramMb}
          vramKnown={vramKnown}
          disabled={modelBusy}
          onChange={onModelChange}
        />

        <div className="ml-auto">
          {generating ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ui-text-highlighted)] text-[var(--ui-bg)] transition-opacity hover:opacity-90"
            >
              <IconStop size={14} />
            </button>
          ) : (
            <button
              type="button"
              disabled={!canSend}
              onClick={submit}
              aria-label="Send message"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ui-primary)] text-[var(--ui-text-inverted)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:text-[var(--ui-bg)]"
            >
              <IconArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
