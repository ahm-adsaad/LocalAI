import type { DocumentMeta } from '../lib/types'

interface DocumentListProps {
  documents: DocumentMeta[]
  busy: boolean
  onUpload: (file: File) => void
  onDelete: (id: string) => void
}

export function DocumentList({ documents, busy, onUpload, onDelete }: DocumentListProps) {
  return (
    <section className="flex shrink-0 flex-col">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-[family-name:var(--font-display)] text-base text-[var(--color-fg)]">
          PDFs
        </h2>
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-muted)]">
          this chat only
        </span>
      </div>

      <label
        className={`mb-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-panel)]/60 px-4 py-6 text-center transition hover:border-[var(--color-accent-dim)] ${
          busy ? 'pointer-events-none opacity-50' : ''
        }`}
      >
        <span className="text-sm text-[var(--color-fg)]">Add a PDF to this chat</span>
        <span className="mt-1 text-xs text-[var(--color-muted)]">
          Other chats keep their own files
        </span>
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ''
          }}
        />
      </label>

      <ul className="max-h-40 space-y-2 overflow-y-auto">
        {documents.length === 0 ? (
          <li className="px-1 text-sm text-[var(--color-muted)]">
            No PDFs in this chat yet — upload one to ask grounded questions.
          </li>
        ) : (
          documents.map((doc) => (
            <li
              key={doc.id}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--color-fg)]">{doc.name}</p>
                  <p className="mt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-muted)]">
                    {doc.pageCount} pages · {doc.chunkCount} chunks
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(doc.id)}
                  className="shrink-0 text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                >
                  Delete
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
