import type { WebGPUStatus } from '../lib/webgpu'

interface WebGPUGateProps {
  status: WebGPUStatus
}

export function WebGPUGate({ status }: WebGPUGateProps) {
  if (status.ok) return null

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <p className="mb-3 font-[family-name:var(--font-mono)] text-xs tracking-widest text-[var(--color-danger)] uppercase">
        WebGPU required
      </p>
      <h1 className="font-[family-name:var(--font-display)] text-3xl leading-tight text-[var(--color-fg)]">
        This workspace needs a GPU in the browser
      </h1>
      <p className="mt-4 text-[var(--color-fg-dim)] leading-relaxed">
        LocalAI runs the language model and embeddings entirely on your device via
        WebGPU. No server fallback exists — sending your documents elsewhere would
        break the privacy premise.
      </p>
      <p className="mt-4 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4 font-[family-name:var(--font-mono)] text-sm text-[var(--color-warn)]">
        {status.reason}
      </p>
      <ul className="mt-6 space-y-2 text-sm text-[var(--color-muted)]">
        <li>Use Chrome 113+ or Edge 113+ (desktop).</li>
        <li>Enable hardware acceleration in browser settings.</li>
        <li>Update GPU drivers if the adapter request fails.</li>
      </ul>
    </div>
  )
}
