import { useMemo, useRef, useState } from 'react'
import golden from '../../eval/golden.json'
import { answerMatches, retrievalHit } from '../lib/grading'
import { ingestPdf } from '../lib/ingest'
import { answerQuestion } from '../lib/pipeline'
import type { ChatMessage, StoredChunk, TurnStats } from '../lib/types'
import type { WorkerClient } from '../lib/workerClient'
import { IconLoader, IconX } from './Icons'

/**
 * End-to-end bench, opened with `?bench` in the URL. Runs the golden set
 * through the exact chat pipeline on this machine's GPU and grades answers
 * deterministically, so the numbers in the README are reproducible by anyone.
 */

interface GoldenItem {
  id: string
  doc: string
  question: string
  expect: string[]
  answer: string[]
  history?: Array<{ question: string; answer: string }>
}

interface BenchRow {
  id: string
  question: string
  followUp: boolean
  retrievalHit: boolean
  answerOk: boolean
  retrievalQuery?: string
  answer: string
  stats: TurnStats
}

interface BenchPanelProps {
  worker: WorkerClient
  chatId: string
  chunks: StoredChunk[]
  modelId: string
  modelLabel: string
  adapterName?: string
  ready: boolean
  onIngested: () => Promise<void>
  onClose: () => void
}

const ITEMS = golden.items as GoldenItem[]
const DOCS = golden.documents as string[]

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`
}

function fmt(x: number | null, digits = 0, suffix = ''): string {
  return x == null ? '—' : `${x.toFixed(digits)}${suffix}`
}

export default function BenchPanel({
  worker,
  chatId,
  chunks,
  modelId,
  modelLabel,
  adapterName,
  ready,
  onIngested,
  onClose,
}: BenchPanelProps) {
  const [rows, setRows] = useState<BenchRow[]>([])
  const [running, setRunning] = useState(false)
  const [loadingCorpus, setLoadingCorpus] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const cancelRef = useRef(false)

  const loadedDocs = useMemo(
    () => new Set(chunks.map((c) => c.documentName.replace(/\.pdf$/i, ''))),
    [chunks],
  )
  const corpusReady = DOCS.every((d) => loadedDocs.has(d))

  async function loadCorpus() {
    setLoadingCorpus(true)
    try {
      for (const doc of DOCS) {
        if (loadedDocs.has(doc)) continue
        setStatus(`Fetching ${doc}.pdf…`)
        const res = await fetch(`/samples/${doc}.pdf`)
        if (!res.ok) throw new Error(`Could not fetch ${doc}.pdf (${res.status})`)
        const file = new File([await res.blob()], `${doc}.pdf`, { type: 'application/pdf' })
        await ingestPdf(file, chatId, worker, setStatus)
      }
      await onIngested()
      setStatus('Sample corpus indexed.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingCorpus(false)
    }
  }

  async function run() {
    setRunning(true)
    setRows([])
    cancelRef.current = false
    try {
      for (const item of ITEMS) {
        if (cancelRef.current) break
        setStatus(`${item.id}: ${item.question}`)
        const history: ChatMessage[] = (item.history ?? []).flatMap((h) => [
          { role: 'user' as const, content: h.question },
          { role: 'assistant' as const, content: h.answer },
        ])
        try {
          const res = await answerQuestion({
            worker,
            chunks,
            history,
            text: item.question,
            modelId,
          })
          setRows((prev) => [
            ...prev,
            {
              id: item.id,
              question: item.question,
              followUp: Boolean(item.history),
              retrievalHit: retrievalHit(res.sources, item.doc, item.expect),
              answerOk: answerMatches(res.content, item.answer),
              retrievalQuery: res.retrievalQuery,
              answer: res.content,
              stats: res.stats,
            },
          ])
        } catch (err) {
          setRows((prev) => [
            ...prev,
            {
              id: item.id,
              question: item.question,
              followUp: Boolean(item.history),
              retrievalHit: false,
              answerOk: false,
              answer: `Error: ${err instanceof Error ? err.message : String(err)}`,
              stats: {
                modelId,
                ttftMs: null,
                decodeTokPerS: 0,
                prefillTokPerS: null,
                promptTokens: null,
                completionTokens: 0,
                totalMs: 0,
                retrievalMs: null,
                rerankMs: null,
                condenseMs: null,
              },
            },
          ])
        }
      }
      setStatus(cancelRef.current ? 'Stopped.' : 'Done.')
    } finally {
      setRunning(false)
    }
  }

  const single = rows.filter((r) => !r.followUp)
  const follow = rows.filter((r) => r.followUp)
  const summary = {
    n: rows.length,
    retrieval: pct(single.filter((r) => r.retrievalHit).length, single.length),
    answer: pct(single.filter((r) => r.answerOk).length, single.length),
    followRetrieval: pct(follow.filter((r) => r.retrievalHit).length, follow.length),
    followAnswer: pct(follow.filter((r) => r.answerOk).length, follow.length),
    ttft: median(rows.map((r) => r.stats.ttftMs).filter((x): x is number => x != null)),
    decode: median(rows.map((r) => r.stats.decodeTokPerS).filter((x) => x > 0)),
    prefill: median(rows.map((r) => r.stats.prefillTokPerS).filter((x): x is number => x != null)),
    total: median(rows.map((r) => r.stats.totalMs).filter((x) => x > 0)),
    retrievalMs: median(rows.map((r) => r.stats.retrievalMs).filter((x): x is number => x != null)),
    rerankMs: median(rows.map((r) => r.stats.rerankMs).filter((x): x is number => x != null)),
    condenseMs: median(rows.map((r) => r.stats.condenseMs).filter((x): x is number => x != null)),
  }

  const markdown = [
    '| Model | GPU | n | Retrieval hit (single) | Answer acc (single) | Follow-up retrieval | Follow-up answer | TTFT p50 | Decode tok/s p50 | Prefill tok/s p50 | Total p50 | Retrieval p50 | Rerank p50 | Rewrite p50 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| ${modelLabel} | ${adapterName ?? 'unknown'} | ${summary.n} | ${summary.retrieval} | ${summary.answer} | ${summary.followRetrieval} | ${summary.followAnswer} | ${fmt(summary.ttft, 0, ' ms')} | ${fmt(summary.decode, 1)} | ${fmt(summary.prefill, 0)} | ${fmt(summary.total, 0, ' ms')} | ${fmt(summary.retrievalMs, 0, ' ms')} | ${fmt(summary.rerankMs, 0, ' ms')} | ${fmt(summary.condenseMs, 0, ' ms')} |`,
  ].join('\n')

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setStatus('Clipboard unavailable — select the text below instead.')
    }
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-[var(--ui-border)] bg-[var(--ui-bg)] text-sm text-[var(--ui-text)] lg:w-[560px]">
      <div className="flex items-center gap-2 border-b border-[var(--ui-border)] px-4 py-3">
        <h2 className="font-semibold text-[var(--ui-text-highlighted)]">Bench</h2>
        <span className="truncate text-xs text-[var(--ui-text-muted)]">
          {modelLabel} · {adapterName ?? 'GPU unknown'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close bench"
          className="ml-auto rounded-md p-1 text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-elevated)] hover:text-[var(--ui-text)]"
        >
          <IconX size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ui-border)] px-4 py-3">
        <button
          type="button"
          disabled={!ready || loadingCorpus || running || corpusReady}
          onClick={loadCorpus}
          className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {corpusReady ? 'Sample corpus loaded' : loadingCorpus ? 'Indexing…' : 'Load sample corpus'}
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => {
              cancelRef.current = true
            }}
            className="rounded-lg border border-[var(--ui-border)] px-3 py-1.5 text-xs font-medium"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={!ready || !corpusReady || loadingCorpus}
            onClick={run}
            className="rounded-lg bg-[var(--ui-primary)] px-3 py-1.5 text-xs font-medium text-[var(--ui-text-inverted)] disabled:opacity-50 dark:text-[var(--ui-bg)]"
          >
            Run {ITEMS.length} questions
          </button>
        )}
        <button
          type="button"
          disabled={rows.length === 0 || running}
          onClick={copyMarkdown}
          className="rounded-lg border border-[var(--ui-border)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {copied ? 'Copied' : 'Copy markdown'}
        </button>
        {status ? (
          <span className="flex w-full items-center gap-1.5 truncate text-xs text-[var(--ui-text-muted)]">
            {running || loadingCorpus ? <IconLoader size={12} /> : null}
            {status}
          </span>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-[var(--ui-border)] px-4 py-3 font-mono text-xs sm:grid-cols-3">
          <Stat label="retrieval hit" value={summary.retrieval} />
          <Stat label="answer acc" value={summary.answer} />
          <Stat label="follow-up acc" value={`${summary.followRetrieval} / ${summary.followAnswer}`} />
          <Stat label="TTFT p50" value={fmt(summary.ttft, 0, ' ms')} />
          <Stat label="decode p50" value={fmt(summary.decode, 1, ' tok/s')} />
          <Stat label="prefill p50" value={fmt(summary.prefill, 0, ' tok/s')} />
          <Stat label="total p50" value={fmt(summary.total, 0, ' ms')} />
          <Stat label="retrieval p50" value={fmt(summary.retrievalMs, 0, ' ms')} />
          <Stat label="rerank p50" value={fmt(summary.rerankMs, 0, ' ms')} />
          <Stat label="rewrite p50" value={fmt(summary.condenseMs, 0, ' ms')} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((r) => (
          <details key={r.id} className="border-b border-[var(--ui-border)] px-4 py-2">
            <summary className="flex cursor-pointer items-center gap-2 text-xs">
              <span className={r.retrievalHit ? 'text-[var(--ui-success)]' : 'text-[var(--ui-error)]'}>
                {r.retrievalHit ? 'R✓' : 'R✗'}
              </span>
              <span className={r.answerOk ? 'text-[var(--ui-success)]' : 'text-[var(--ui-error)]'}>
                {r.answerOk ? 'A✓' : 'A✗'}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono text-[var(--ui-text-dimmed)]">{r.id}</span> {r.question}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--ui-text-dimmed)]">
                {r.stats.decodeTokPerS.toFixed(1)} tok/s
              </span>
            </summary>
            {r.retrievalQuery ? (
              <p className="mt-1 text-[11px] text-[var(--ui-text-dimmed)]">searched as “{r.retrievalQuery}”</p>
            ) : null}
            <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--ui-text-muted)]">{r.answer}</p>
          </details>
        ))}
      </div>

      {rows.length > 0 && !running ? (
        <textarea
          readOnly
          value={markdown}
          className="h-20 w-full shrink-0 resize-none border-t border-[var(--ui-border)] bg-[var(--ui-bg-muted)] p-2 font-mono text-[10px] text-[var(--ui-text-muted)] outline-none"
        />
      ) : null}
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[var(--ui-text-dimmed)]">{label}</span>
      <span className="text-[var(--ui-text-highlighted)]">{value}</span>
    </div>
  )
}
