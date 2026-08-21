import { EMBED_MODEL_ID } from '../lib/types'
import { MODEL_OPTIONS, type ModelOptionId } from '../lib/models'
import { ModelPicker } from './ModelPicker'

export type ModelPhase =
  | 'idle'
  | 'loading-llm'
  | 'loading-embed'
  | 'ready'
  | 'error'

interface StatusBarProps {
  webgpuOk: boolean
  adapterName?: string
  vramMb?: number
  vramKnown: boolean
  phase: ModelPhase
  progressText?: string
  documentCount: number
  chunkCount: number
  modelId: ModelOptionId
  recommendedModel: ModelOptionId
  modelSwitching?: boolean
  onModelChange: (id: ModelOptionId) => void
}

export function StatusBar({
  webgpuOk,
  adapterName,
  vramMb,
  vramKnown,
  phase,
  progressText,
  documentCount,
  chunkCount,
  modelId,
  recommendedModel,
  modelSwitching,
  onModelChange,
}: StatusBarProps) {
  const phaseLabel =
    phase === 'ready'
      ? 'Models ready'
      : phase === 'loading-llm'
        ? 'Loading LLM'
        : phase === 'loading-embed'
          ? 'Loading embeddings'
          : phase === 'error'
            ? 'Model error'
            : 'Waiting'

  const active = MODEL_OPTIONS[modelId]

  return (
    <header className="shrink-0 border-b border-[var(--color-line)] bg-[var(--color-ink-soft)]/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <div className="mr-auto">
          <h1 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--color-fg)]">
            LocalAI
          </h1>
          <p className="text-xs text-[var(--color-muted)]">
            On-device · pick the model for the job · nothing leaves this browser
          </p>
        </div>

        <StatusPill
          ok={webgpuOk}
          label={webgpuOk ? `WebGPU${adapterName ? ` · ${adapterName}` : ''}` : 'No WebGPU'}
        />
        <StatusPill
          ok={phase === 'ready' && !modelSwitching}
          warn={phase === 'loading-llm' || phase === 'loading-embed' || modelSwitching}
          label={modelSwitching ? 'Switching model' : phaseLabel}
        />
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-muted)]">
          {documentCount} doc{documentCount === 1 ? '' : 's'} · {chunkCount} chunks
        </span>
      </div>

      <div className="border-t border-[var(--color-line)] px-4 py-2 sm:px-6">
        <ModelPicker
          modelId={modelId}
          recommended={recommendedModel}
          vramMb={vramMb}
          vramKnown={vramKnown}
          disabled={phase === 'loading-llm' || phase === 'loading-embed' || modelSwitching}
          onChange={onModelChange}
        />
        {(phase === 'loading-llm' || phase === 'loading-embed' || modelSwitching) &&
        progressText ? (
          <p className="mt-1.5 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-muted)]">
            {progressText}
          </p>
        ) : (
          <p className="mt-1.5 truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-line)]">
            {active.label} · {active.modelId} · Embed {EMBED_MODEL_ID}
          </p>
        )}
      </div>
    </header>
  )
}

function StatusPill({
  ok,
  warn,
  label,
}: {
  ok: boolean
  warn?: boolean
  label: string
}) {
  const color = ok
    ? 'text-[var(--color-accent)]'
    : warn
      ? 'text-[var(--color-warn)]'
      : 'text-[var(--color-danger)]'
  const dot = ok
    ? 'bg-[var(--color-accent)]'
    : warn
      ? 'bg-[var(--color-warn)]'
      : 'bg-[var(--color-danger)]'

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] ${color}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
