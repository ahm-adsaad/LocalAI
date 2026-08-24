import { useEffect, useRef, useState } from 'react'
import {
  MODEL_MATRIX,
  MODEL_OPTIONS,
  MODEL_ORDER,
  modelFitsComfortably,
  type ModelOptionId,
} from '../lib/models'
import { EMBED_MODEL_ID } from '../lib/types'
import { IconCheck, IconChevronDown, IconCpu, IconInfo, IconX } from './Icons'

interface ModelMenuProps {
  modelId: ModelOptionId
  recommended: ModelOptionId
  vramMb?: number
  vramKnown: boolean
  disabled?: boolean
  onChange: (id: ModelOptionId) => void
}

/**
 * Model selector living inside the prompt input, like the template's
 * ModelSelect. Opens upward; includes a "model guide" modal with the
 * full when-to-use-which matrix.
 */
export function ModelMenu({
  modelId,
  recommended,
  vramMb,
  vramKnown,
  disabled,
  onChange,
}: ModelMenuProps) {
  const [open, setOpen] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = MODEL_OPTIONS[modelId]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconCpu size={14} />
        <span className="max-w-36 truncate">{active.label}</span>
        <IconChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="On-device model"
          className="absolute bottom-full left-0 z-30 mb-2 w-80 overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg)] shadow-xl"
        >
          <div className="max-h-80 overflow-y-auto p-1">
            {MODEL_ORDER.map((id) => {
              const m = MODEL_OPTIONS[id]
              const selected = id === modelId
              const isRec = id === recommended
              const tight = vramKnown && !modelFitsComfortably(id, vramMb)
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setOpen(false)
                    if (!selected) onChange(id)
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    selected ? 'bg-[var(--ui-bg-elevated)]' : 'hover:bg-[var(--ui-bg-elevated)]'
                  }`}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-[var(--ui-primary)]">
                    {selected ? <IconCheck size={15} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-[var(--ui-text-highlighted)]">
                        {m.label}
                      </span>
                      {isRec ? (
                        <span className="shrink-0 rounded-full bg-[var(--ui-primary-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ui-primary)]">
                          GPU pick
                        </span>
                      ) : null}
                      {tight ? (
                        <span className="shrink-0 rounded-full bg-[var(--ui-warning)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--ui-warning)]">
                          may be tight
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--ui-text-muted)]">
                      {m.whenYouNeed}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="border-t border-[var(--ui-border)] p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setShowGuide(true)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)]"
            >
              <IconInfo size={14} />
              When to use which model
            </button>
          </div>
        </div>
      ) : null}

      {showGuide ? (
        <ModelGuideModal
          modelId={modelId}
          recommended={recommended}
          vramMb={vramMb}
          vramKnown={vramKnown}
          disabled={disabled}
          onChange={(id) => {
            setShowGuide(false)
            onChange(id)
          }}
          onClose={() => setShowGuide(false)}
        />
      ) : null}
    </div>
  )
}

function ModelGuideModal({
  modelId,
  recommended,
  vramMb,
  vramKnown,
  disabled,
  onChange,
  onClose,
}: ModelMenuProps & { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Model guide"
    >
      <div className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--ui-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ui-text-highlighted)]">
              Choosing an on-device model
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ui-text-muted)]">
              {vramKnown && vramMb != null
                ? `~${(vramMb / 1024).toFixed(1)} GB VRAM detected`
                : 'VRAM unknown'}{' '}
              · everything runs locally on WebGPU
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)]"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {MODEL_MATRIX.map((row) => {
            const m = MODEL_OPTIONS[row.modelId]
            const selected = row.modelId === modelId
            const isRec = row.modelId === recommended
            const tight = vramKnown && !modelFitsComfortably(row.modelId, vramMb)
            return (
              <div
                key={row.modelId}
                className={`rounded-xl border p-4 ${
                  selected
                    ? 'border-[var(--ui-primary)]/40 bg-[var(--ui-primary-soft)]'
                    : 'border-[var(--ui-border)]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--ui-text-highlighted)]">
                      {row.whenYouNeed}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
                      {m.label} · {m.family} · {m.speed} · ~{m.approxVramMb} MB
                      {isRec ? (
                        <span className="ml-1.5 font-medium text-[var(--ui-primary)]">
                          recommended for this GPU
                        </span>
                      ) : null}
                      {tight ? (
                        <span className="ml-1.5 font-medium text-[var(--ui-warning)]">
                          may be tight on VRAM
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--ui-text-dimmed)]">
                      {m.examples.join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled || selected}
                    onClick={() => onChange(row.modelId)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]'
                        : 'border border-[var(--ui-border)] text-[var(--ui-text)] hover:bg-[var(--ui-bg-elevated)]'
                    } disabled:cursor-not-allowed`}
                  >
                    {selected ? 'Active' : 'Use model'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <p className="border-t border-[var(--ui-border)] px-5 py-3 text-xs leading-relaxed text-[var(--ui-text-dimmed)]">
          Qwen usually leads doc Q&A per size; Phi is stronger at precise extraction; Llama is
          the familiar Meta baseline. Embeddings: {EMBED_MODEL_ID}. Nothing is sent to a server
          when you switch.
        </p>
      </div>
    </div>
  )
}
