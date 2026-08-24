import { useState } from 'react'
import { getTheme, setTheme } from '../lib/theme'
import { IconDownload, IconMoon, IconSidebar, IconSun } from './Icons'

interface NavbarProps {
  title: string
  sidebarOpen: boolean
  onToggleSidebar: () => void
  canExport: boolean
  exportDisabled: boolean
  onExport: () => void
}

export function Navbar({
  title,
  sidebarOpen,
  onToggleSidebar,
  canExport,
  exportDisabled,
  onExport,
}: NavbarProps) {
  const [theme, setThemeState] = useState(getTheme)

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--ui-border)] px-3">
      {/* Collapsing lives in the sidebar itself; this only reopens it when hidden. */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Open sidebar"
        className={`rounded-lg p-1.5 text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)] ${
          sidebarOpen ? 'lg:hidden' : ''
        }`}
      >
        <IconSidebar size={16} />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ui-text-highlighted)]">
        {title}
      </h1>

      {canExport ? (
        <button
          type="button"
          disabled={exportDisabled}
          onClick={onExport}
          title="Export chat as Markdown"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconDownload size={14} />
          <span className="hidden sm:inline">Export</span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="rounded-lg p-1.5 text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)]"
      >
        {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
      </button>
    </header>
  )
}
