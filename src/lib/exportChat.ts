import type { ChatSession } from './types'

function safeFileStem(title: string): string {
  const stem = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 48)
  return stem || 'chat'
}

/** Download the current chat as Markdown (stays on-device — blob URL only). */
export function downloadChatMarkdown(session: ChatSession): void {
  const lines: string[] = [`# ${session.title}`, '', `Exported: ${new Date().toISOString()}`, '']

  for (const turn of session.turns) {
    if (turn.streaming) continue
    const who = turn.role === 'user' ? 'You' : 'Assistant'
    lines.push(`## ${who}`, '', turn.content.trim() || '_(empty)_', '')
    if (turn.sources?.length) {
      lines.push('### Sources', '')
      for (const [i, s] of turn.sources.entries()) {
        lines.push(
          `- [${i + 1}] ${s.documentName} (score ${s.score.toFixed(3)})`,
          '',
          '```',
          s.text.trim(),
          '```',
          '',
        )
      }
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileStem(session.title)}.md`
  a.click()
  URL.revokeObjectURL(url)
}
