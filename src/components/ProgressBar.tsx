interface ProgressBarProps {
  value: number
  label?: string
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))

  return (
    <div className="w-full">
      {label ? (
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-[var(--color-muted)]">
          <span className="truncate font-[family-name:var(--font-mono)]">{label}</span>
          <span className="shrink-0 tabular-nums">{pct}%</span>
        </div>
      ) : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
