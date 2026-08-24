import { useEffect } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Styled replacement for window.confirm, matching the template's ModalConfirm. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-sm rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg)] p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-[var(--ui-text-highlighted)]">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ui-text-muted)]">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--ui-border)] px-3 py-1.5 text-sm font-medium text-[var(--ui-text)] transition-colors hover:bg-[var(--ui-bg-elevated)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-[var(--ui-error)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:text-[var(--ui-text-inverted)]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
