import type { WebGPUStatus } from '../lib/webgpu'
import { Logo } from './Icons'

interface WebGPUGateProps {
  status: WebGPUStatus
}

export function WebGPUGate({ status }: WebGPUGateProps) {
  if (status.ok) return null

  return (
    <div className="flex h-dvh items-center justify-center bg-[var(--ui-bg-muted)] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg)] p-8 shadow-sm">
        <div className="flex items-center gap-2.5 text-[var(--ui-text-highlighted)]">
          <Logo size={22} className="text-[var(--ui-primary)]" />
          <span className="text-sm font-semibold">LocalAI</span>
        </div>

        <h1 className="mt-6 text-xl font-semibold text-[var(--ui-text-highlighted)]">
          WebGPU is required
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ui-text-muted)]">
          LocalAI runs the language model and embeddings entirely on your device via WebGPU.
          There is no server fallback, since sending your documents elsewhere would break
          the privacy premise.
        </p>

        <p className="mt-4 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-3 font-mono text-xs leading-relaxed text-[var(--ui-warning)]">
          {status.reason}
        </p>

        <ul className="mt-5 space-y-2 text-sm text-[var(--ui-text-muted)]">
          <li className="flex gap-2">
            <span className="text-[var(--ui-text-dimmed)]">·</span>
            Use Chrome 113+ or Edge 113+ (desktop).
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--ui-text-dimmed)]">·</span>
            Enable hardware acceleration in browser settings.
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--ui-text-dimmed)]">·</span>
            Update GPU drivers if the adapter request fails.
          </li>
        </ul>
      </div>
    </div>
  )
}
