import { useState } from 'react'
import {
  MODEL_MATRIX,
  MODEL_OPTIONS,
  MODEL_ORDER,
  modelFitsComfortably,
  type ModelOptionId,
} from '../lib/models'

interface ModelPickerProps {
  modelId: ModelOptionId
  recommended: ModelOptionId
  vramMb?: number
  vramKnown: boolean
  disabled?: boolean
  onChange: (id: ModelOptionId) => void
}

export function ModelPicker({
  modelId,
  recommended,
  vramMb,
  vramKnown,
  disabled,
  onChange,
}: ModelPickerProps) {
  const [showMatrix, setShowMatrix] = useState(false)
  const active = MODEL_OPTIONS[modelId]
  const tight = !modelFitsComfortably(modelId, vramMb)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="model-option">
          On-device model
        </label>
        <select
          id="model-option"
          value={modelId}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as ModelOptionId)}
          className="max-w-full rounded-md border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent-dim)] disabled:opacity-50"
        >
          {MODEL_ORDER.map((id) => {
            const m = MODEL_OPTIONS[id]
            const rec = id === recommended ? ' · GPU pick' : ''
            const warn =
              vramKnown && !modelFitsComfortably(id, vramMb) ? ' · may be tight' : ''
            return (
              <option key={id} value={id}>
                {m.label} — {m.whenYouNeed}
                {rec}
                {warn}
              </option>
            )
          })}
        </select>
        <button
          type="button"
          onClick={() => setShowMatrix((v) => !v)}
          className="rounded border border-[var(--color-line)] px-2 py-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-muted)] hover:border-[var(--color-accent-dim)] hover:text-[var(--color-fg)]"
        >
          {showMatrix ? 'Hide guide' : 'When to use which'}
        </button>
        <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-muted)]">
          {vramKnown && vramMb != null
            ? `~${(vramMb / 1024).toFixed(1)} GB VRAM · ${active.modelId}`
            : `VRAM unknown · ${active.modelId}`}
          {tight && vramKnown ? ' · running above comfort zone' : ''}
        </span>
      </div>

      {showMatrix ? (
        <div className="overflow-x-auto rounded-md border border-[var(--color-line)] bg-[var(--color-ink)]/60">
          <table className="w-full min-w-[640px] border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-[var(--color-muted)]">
                <th className="px-3 py-2 font-medium">When you need…</th>
                <th className="px-3 py-2 font-medium">Start with…</th>
                <th className="px-3 py-2 font-medium">Example use cases</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {MODEL_MATRIX.map((row) => {
                const m = MODEL_OPTIONS[row.modelId]
                const selected = row.modelId === modelId
                const rec = row.modelId === recommended
                return (
                  <tr
                    key={row.modelId}
                    className={`border-b border-[var(--color-line)]/70 ${
                      selected ? 'bg-[var(--color-accent-dim)]/10' : ''
                    }`}
                  >
                    <td className="px-3 py-2 align-top text-[var(--color-fg-dim)]">
                      {row.whenYouNeed}
                      {rec ? (
                        <span className="mt-1 block font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-accent)]">
                          recommended for this GPU
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="font-medium text-[var(--color-fg)]">{m.label}</p>
                      <p className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-muted)]">
                        {m.family} · {m.speed} · ~{m.approxVramMb} MB
                      </p>
                    </td>
                    <td className="px-3 py-2 align-top text-[var(--color-muted)]">
                      {m.examples.join('; ')}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <button
                        type="button"
                        disabled={disabled || selected}
                        onClick={() => onChange(row.modelId)}
                        className="rounded border border-[var(--color-line)] px-2 py-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-accent)] hover:border-[var(--color-accent-dim)] disabled:opacity-40"
                      >
                        {selected ? 'Active' : 'Use'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t border-[var(--color-line)] px-3 py-2 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-muted)]">
            All options run locally on WebGPU. Qwen usually leads doc Q&A per size; Phi is
            stronger at precise extraction; Llama is the familiar Meta baseline. Nothing is
            sent to a server when you switch.
          </p>
        </div>
      ) : null}
    </div>
  )
}
