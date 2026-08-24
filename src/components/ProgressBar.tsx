interface ProgressBarProps {
  value: number
  label?: string
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))

  return (
    <div className="w-full">
      {label ? (
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--ui-text-muted)]">
          <span className="truncate">{label}</span>
          <span className="shrink-0 font-mono tabular-nums">{pct}%</span>
        </div>
      ) : null}
      <div className="h-1 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
        <div
          className="h-full rounded-full bg-[var(--ui-primary)] transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
