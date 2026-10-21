import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { ConfirmDialog } from './components/ConfirmDialog'
import { IconFileText, Logo } from './components/Icons'
import { Messages } from './components/Messages'
import { Navbar } from './components/Navbar'
import { ProgressBar } from './components/ProgressBar'
import { PromptInput } from './components/PromptInput'
import { Sidebar } from './components/Sidebar'
import { WebGPUGate } from './components/WebGPUGate'
import {
  adoptOrphanDocuments,
  clearChatLibrary,
  countDocumentsByChat,
  deleteChatCascade,
  deleteDocument,
  getActiveChatId,
  getChat,
  getChunksForChat,
  getPreferredModelTier,
  listChats,
  listDocumentsForChat,
  saveChat,
  setActiveChatId,
  setPreferredModelTier,
  titleFromDocumentName,
  titleFromTurns,
} from './lib/db'
import { downloadChatMarkdown } from './lib/exportChat'
import { isGpuMemoryFailure } from './lib/gpuErrors'
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  nextSmallerModel,
  recommendModel,
  resolveModelOptionId,
  type ModelOptionId,
} from './lib/models'
import { extractionToMarkdown } from './lib/extract'
import { ingestPdf } from './lib/ingest'
import { isSupportedFile } from './lib/inputs'
import { answerQuestion } from './lib/pipeline'
import type {
  ChatMessage,
  ChatSession,
  ChatTurn,
  DocumentMeta,
  ModelPhase,
  StoredChunk,
} from './lib/types'
import { checkWebGPU, type WebGPUStatus } from './lib/webgpu'
import { getWorkerClient } from './lib/workerClient'

/** Dev/bench tooling stays out of the main bundle; opened with `?bench`. */
const BenchPanel = lazy(() => import('./components/BenchPanel'))
const urlParams = new URLSearchParams(window.location.search)
const benchRequested = urlParams.has('bench')
/** `?model=qwen-fast` pins the boot model (used by the e2e privacy audit). */
const urlModel = urlParams.get('model')
/** `?simulateOom=<model id>` makes that model fail to load as if out of GPU memory (e2e). */
const simulateOom = urlParams.get('simulateOom')

function uid() {
  return crypto.randomUUID()
}

/** Survive React StrictMode remounts so we only download/load weights once. */
let modelBootPromise: Promise<LoadedModel> | null = null
type BootProgress = (p: { progress: number; text: string }) => void
const bootProgressSubs = new Set<BootProgress>()

type LoadedModel = { id: ModelOptionId; notice: string | null }

/**
 * Loads `initial`; when the GPU cannot hold it, steps down to the next smaller
 * model. Only the model that actually loaded is saved as the preference.
 */
async function loadWithFallback(
  worker: ReturnType<typeof getWorkerClient>,
  initial: ModelOptionId,
  report: BootProgress,
): Promise<LoadedModel> {
  for (let id: ModelOptionId | null = initial; id; id = nextSmallerModel(id)) {
    const spec = MODEL_OPTIONS[id]
    if (id !== initial) {
      report({ progress: 0.02, text: `Loading ${spec.label} · ${spec.modelId}…` })
    }
    try {
      await worker.initLLM(
        {
          modelId: spec.modelId,
          contextWindow: spec.contextWindow,
          simulateFailure: simulateOom === id ? 'oom' : undefined,
        },
        report,
      )
    } catch (err) {
      if (!isGpuMemoryFailure(err) || !nextSmallerModel(id)) throw err
      continue
    }
    await setPreferredModelTier(id)
    const notice =
      id === initial
        ? null
        : `${MODEL_OPTIONS[initial].label} did not fit in this GPU's memory; using ${spec.label} instead.`
    return { id, notice }
  }
  throw new Error('No model could be loaded')
}

function newSession(): ChatSession {
  const now = Date.now()
  return {
    id: uid(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    turns: [],
  }
}

const SIDEBAR_KEY = 'localai-sidebar'

function initialSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'closed'
  } catch {
    return true
  }
}

type PendingConfirm =
  | { kind: 'delete-chat'; chat: ChatSession }
  | { kind: 'clear-library'; count: number }

export default function App() {
  const [gpu, setGpu] = useState<WebGPUStatus | null>(null)
  const [phase, setPhase] = useState<ModelPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [modelError, setModelError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ModelOptionId>(DEFAULT_MODEL)
  const [recommendedModel, setRecommendedModel] = useState<ModelOptionId>(DEFAULT_MODEL)
  const [modelSwitching, setModelSwitching] = useState(false)
  const [modelNotice, setModelNotice] = useState<string | null>(null)

  const [documents, setDocuments] = useState<DocumentMeta[]>([])
  const [chunks, setChunks] = useState<StoredChunk[]>([])
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const [ingestBusy, setIngestBusy] = useState(false)
  const [ingestMsg, setIngestMsg] = useState<string | null>(null)

  const [chats, setChats] = useState<ChatSession[]>([])
  const [session, setSession] = useState<ChatSession>(() => newSession())
  const [generating, setGenerating] = useState(false)
  const [activity, setActivity] = useState<string | null>(null)

  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [benchOpen, setBenchOpen] = useState(benchRequested)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)

  const sessionRef = useRef(session)
  sessionRef.current = session

  const worker = useMemo(() => getWorkerClient(), [])

  /** Loads `next`, or a smaller model if it does not fit; returns the model actually loaded. */
  const loadLlm = useCallback(
    async (next: ModelOptionId, opts?: { switching?: boolean }): Promise<ModelOptionId> => {
      const spec = MODEL_OPTIONS[next]
      if (opts?.switching) setModelSwitching(true)
      else setPhase('loading-llm')
      setProgress(0)
      setProgressText(`Loading ${spec.label} · ${spec.modelId}…`)
      const loaded = await loadWithFallback(worker, next, (p) => {
        setProgress(p.progress)
        setProgressText(p.text)
      })
      setSelectedModel(loaded.id)
      setModelNotice(loaded.notice)
      if (opts?.switching) setModelSwitching(false)
      return loaded.id
    },
    [worker],
  )

  const refreshChats = useCallback(async () => {
    const [listed, counts] = await Promise.all([listChats(), countDocumentsByChat()])
    setChats(listed)
    setDocCounts(counts)
  }, [])

  const loadChatLibrary = useCallback(async (chatId: string) => {
    const [docs, chatChunks] = await Promise.all([
      listDocumentsForChat(chatId),
      getChunksForChat(chatId),
    ])
    setDocuments(docs)
    setChunks(chatChunks)
  }, [])

  const persistSession = useCallback(
    async (next: ChatSession) => {
      const toSave: ChatSession = {
        ...next,
        title:
          next.title !== 'New chat' && next.turns.every((t) => t.role !== 'user')
            ? next.title
            : titleFromTurns(next.turns) !== 'New chat'
              ? titleFromTurns(next.turns)
              : next.title,
        updatedAt: Date.now(),
      }
      // Prefer first-user-message title when present.
      const fromTurns = titleFromTurns(next.turns)
      if (fromTurns !== 'New chat') toSave.title = fromTurns

      await saveChat(toSave)
      await setActiveChatId(toSave.id)
      setSession(toSave)
      await refreshChats()
    },
    [refreshChats],
  )

  // Phase 0 — WebGPU gate before any model work.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const status = await checkWebGPU()
      if (!cancelled) setGpu(status)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Restore chats; adopt legacy global PDFs into the active chat once.
  useEffect(() => {
    if (!gpu?.ok) return
    let cancelled = false
    ;(async () => {
      const [listed, activeId] = await Promise.all([listChats(), getActiveChatId()])
      if (cancelled) return

      let current: ChatSession
      if (activeId) {
        const existing = await getChat(activeId)
        current = existing ?? listed[0] ?? newSession()
      } else {
        current = listed[0] ?? newSession()
      }

      if (!listed.find((c) => c.id === current.id)) {
        await saveChat(current)
      }
      await setActiveChatId(current.id)
      await adoptOrphanDocuments(current.id)
      if (cancelled) return

      setSession(current)
      await refreshChats()
      await loadChatLibrary(current.id)
    })()
    return () => {
      cancelled = true
    }
  }, [gpu, refreshChats, loadChatLibrary])

  // Phase 1 + 2 model boot once WebGPU passes — pick tier from VRAM / saved preference.
  useEffect(() => {
    if (!gpu?.ok) return
    let cancelled = false

    const onBootProgress: BootProgress = (p) => {
      if (cancelled) return
      setProgress(p.progress)
      setProgressText(p.text)
    }
    bootProgressSubs.add(onBootProgress)

    ;(async () => {
      try {
        const vram = gpu.vramMb
        const suggested = recommendModel(vram)
        if (!cancelled) {
          setRecommendedModel(suggested)
          setPhase('loading-llm')
          setProgressText('Loading on-device model for your GPU…')
        }

        if (!modelBootPromise) {
          modelBootPromise = (async () => {
            const saved = await getPreferredModelTier()
            const initial = resolveModelOptionId(urlModel) ?? resolveModelOptionId(saved) ?? suggested
            const spec = MODEL_OPTIONS[initial]
            const fanout: BootProgress = (p) => {
              for (const cb of bootProgressSubs) cb(p)
            }
            fanout({ progress: 0.02, text: `Loading ${spec.label} · ${spec.modelId}…` })
            const loaded = await loadWithFallback(worker, initial, fanout)
            fanout({ progress: 0.05, text: 'Loading embedding model…' })
            await worker.initEmbedder(fanout)
            return loaded
          })().catch((err) => {
            modelBootPromise = null
            throw err
          })
        }

        const loaded = await modelBootPromise
        if (cancelled) return

        setSelectedModel(loaded.id)
        setModelNotice(loaded.notice)
        setPhase('ready')
        setProgress(1)
        setProgressText('Ready')
      } catch (err) {
        if (cancelled) return
        setPhase('error')
        setModelError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
      bootProgressSubs.delete(onBootProgress)
    }
  }, [gpu, worker])

  async function handleModelChange(next: ModelOptionId) {
    if (next === selectedModel || modelSwitching || phase === 'loading-llm') return
    if (generating) worker.abort()
    setModelError(null)
    try {
      await loadLlm(next, { switching: true })
      setPhase('ready')
      setProgressText('Ready')
    } catch (err) {
      setPhase('error')
      setModelSwitching(false)
      setModelError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleUpload(file: File) {
    if (phase !== 'ready') return
    setIngestBusy(true)
    setIngestMsg(`Reading ${file.name}…`)

    try {
      // Ensure the chat row exists before attaching a PDF to it.
      const chat = sessionRef.current
      await saveChat(chat)
      await setActiveChatId(chat.id)

      const { chunks: stored } = await ingestPdf(file, chat.id, worker, setIngestMsg)

      // Name empty chats after their first PDF.
      if (chat.title === 'New chat' || chat.turns.length === 0) {
        const named = {
          ...chat,
          title: titleFromDocumentName(file.name),
          updatedAt: Date.now(),
        }
        await saveChat(named)
        setSession(named)
      }

      await loadChatLibrary(chat.id)
      await refreshChats()
      setIngestMsg(`Indexed ${stored.length} chunks for this chat.`)
    } catch (err) {
      setIngestMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setIngestBusy(false)
    }
  }

  async function handleDeleteDoc(doc: DocumentMeta) {
    await deleteDocument(doc.id)
    await loadChatLibrary(sessionRef.current.id)
    await refreshChats()
  }

  async function handleClearLibraryConfirmed() {
    const chatId = sessionRef.current.id
    await clearChatLibrary(chatId)
    await loadChatLibrary(chatId)
    await refreshChats()
    setIngestMsg('Cleared this chat’s PDF library.')
  }

  function handleExportChat() {
    downloadChatMarkdown(sessionRef.current)
  }

  const handleNewChat = useCallback(async () => {
    if (generating) worker.abort()
    const fresh = newSession()
    await saveChat(fresh)
    await setActiveChatId(fresh.id)
    setSession(fresh)
    setDocuments([])
    setChunks([])
    setIngestMsg(null)
    await refreshChats()
  }, [generating, worker, refreshChats])

  // ⌘⇧O / Ctrl+Shift+O starts a new chat, like the template.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void handleNewChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleNewChat])

  async function handleSelectChat(id: string) {
    setMobileSidebarOpen(false)
    if (id === session.id) return
    if (generating) worker.abort()
    const existing = await getChat(id)
    if (!existing) return
    setSession(existing)
    await setActiveChatId(id)
    setIngestMsg(null)
    await loadChatLibrary(id)
  }

  async function handleDeleteChatConfirmed(id: string) {
    if (generating && id === session.id) worker.abort()
    await deleteChatCascade(id)
    const remaining = await listChats()
    setChats(remaining)
    setDocCounts(await countDocumentsByChat())

    if (id === session.id) {
      const next = remaining[0] ?? newSession()
      if (!remaining[0]) await saveChat(next)
      setSession(next)
      await setActiveChatId(next.id)
      await loadChatLibrary(next.id)
      setIngestMsg(null)
    }
  }

  async function handleSend(text: string) {
    if (phase !== 'ready' || generating) return

    const userTurn: ChatTurn = { id: uid(), role: 'user', content: text }
    const assistantId = uid()
    const chatId = sessionRef.current.id

    setSession((prev) => ({
      ...prev,
      turns: [
        ...prev.turns,
        userTurn,
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ],
    }))
    setGenerating(true)

    let pending = ''
    let raf = 0
    const flushTokens = () => {
      raf = 0
      if (!pending) return
      const chunk = pending
      pending = ''
      setSession((prev) => {
        if (prev.id !== chatId) return prev
        return {
          ...prev,
          turns: prev.turns.map((t) =>
            t.id === assistantId ? { ...t, content: t.content + chunk } : t,
          ),
        }
      })
    }
    const onToken = (token: string) => {
      pending += token
      if (!raf) raf = requestAnimationFrame(flushTokens)
    }

    try {
      const history: ChatMessage[] = sessionRef.current.turns
        .filter((t) => !t.streaming && t.content.trim())
        .map((t) => ({ role: t.role, content: t.content }))

      // RAG only over PDFs attached to this chat; plain chat otherwise.
      const result = await answerQuestion({
        worker,
        chunks,
        history,
        text,
        modelId: MODEL_OPTIONS[selectedModel].modelId,
        onToken,
        onActivity: setActivity,
      })
      if (raf) cancelAnimationFrame(raf)
      flushTokens()

      setSession((prev) => {
        if (prev.id !== chatId) return prev
        const next: ChatSession = {
          ...prev,
          turns: prev.turns.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  streaming: false,
                  content: result.extraction ? extractionToMarkdown(result.extraction) : t.content,
                  sources: result.sources.length > 0 ? result.sources : undefined,
                  stats: result.stats,
                  retrievalQuery: result.retrievalQuery,
                  extraction: result.extraction,
                  aborted: result.aborted || undefined,
                }
              : t,
          ),
        }
        void persistSession(next)
        return next
      })
    } catch (err) {
      if (raf) cancelAnimationFrame(raf)
      flushTokens()
      const message = err instanceof Error ? err.message : String(err)
      setSession((prev) => {
        if (prev.id !== chatId) return prev
        const next: ChatSession = {
          ...prev,
          turns: prev.turns.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  streaming: false,
                  content: t.content || `Error: ${message}`,
                }
              : t,
          ),
        }
        void persistSession(next)
        return next
      })
    } finally {
      setGenerating(false)
      setActivity(null)
    }
  }

  function toggleSidebar() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSidebarOpen((open) => {
        try {
          localStorage.setItem(SIDEBAR_KEY, open ? 'closed' : 'open')
        } catch {
          // Persistence is best-effort.
        }
        return !open
      })
    } else {
      setMobileSidebarOpen((open) => !open)
    }
  }

  const modelsReady = phase === 'ready'
  const chatBusy = generating || ingestBusy

  function onDragEnter(e: DragEvent) {
    if (!modelsReady || ingestBusy) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }

  function onDragOver(e: DragEvent) {
    if (!dragActive) return
    e.preventDefault()
  }

  function onDragLeave(e: DragEvent) {
    if (!dragActive) return
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }

  function onDrop(e: DragEvent) {
    if (!dragActive) return
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    const file = Array.from(e.dataTransfer.files).find(isSupportedFile)
    if (file) void handleUpload(file)
    else setIngestMsg('Only PDF, text, Markdown or DOCX files can be added to a chat.')
  }

  if (!gpu) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--ui-bg-muted)] text-sm text-[var(--ui-text-muted)]">
        Checking WebGPU…
      </div>
    )
  }

  if (!gpu.ok) {
    return <WebGPUGate status={gpu} />
  }

  const loading = phase === 'loading-llm' || phase === 'loading-embed' || modelSwitching
  const emptyChat = session.turns.length === 0

  const sidebarStatus = {
    phase,
    modelSwitching,
    adapterName: gpu.adapterName,
    vramMb: gpu.vramMb,
    vramKnown: gpu.vramSource === 'adapter-info',
    modelId: selectedModel,
    documentCount: documents.length,
    chunkCount: chunks.length,
  }

  const sidebar = (
    <Sidebar
      chats={chats}
      activeId={session.id}
      docCounts={docCounts}
      busy={chatBusy}
      status={sidebarStatus}
      onSelect={handleSelectChat}
      onNew={handleNewChat}
      onDelete={(chat) => setPendingConfirm({ kind: 'delete-chat', chat })}
      onCollapse={toggleSidebar}
    />
  )

  const promptInput = (
    <PromptInput
      disabled={!modelsReady}
      generating={generating}
      onSend={handleSend}
      onStop={() => worker.abort()}
      documents={documents}
      ingestBusy={ingestBusy}
      onUpload={handleUpload}
      onDeleteDoc={handleDeleteDoc}
      onClearLibrary={() =>
        setPendingConfirm({ kind: 'clear-library', count: documents.length })
      }
      modelId={selectedModel}
      recommendedModel={recommendedModel}
      vramMb={gpu.vramMb}
      vramKnown={gpu.vramSource === 'adapter-info'}
      modelBusy={loading}
      onModelChange={handleModelChange}
      placeholder={
        modelsReady
          ? documents.length > 0
            ? 'Ask a question about this chat’s PDFs…'
            : 'Add a PDF to this chat, or chat without one…'
          : 'Waiting for models…'
      }
    />
  )

  return (
    <div className="flex h-dvh bg-[var(--ui-bg-muted)]">
      {/* Desktop sidebar */}
      {sidebarOpen ? (
        <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>
      ) : null}

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-[var(--ui-border)] bg-[var(--ui-bg-muted)] shadow-2xl">
            {sidebar}
          </aside>
        </div>
      ) : null}

      {/* Main panel — the template's ring-bordered rounded content card. */}
      <div className="flex min-w-0 flex-1 flex-col p-2">
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg)] shadow-sm"
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <Navbar
            title={session.title}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            canExport={session.turns.some((t) => !t.streaming && t.content.trim())}
            exportDisabled={generating}
            onExport={handleExportChat}
          />

          {loading && !emptyChat ? (
            <div className="shrink-0 border-b border-[var(--ui-border)] px-4 py-2.5 sm:px-6">
              <ProgressBar value={progress} label={progressText || 'Loading…'} />
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="shrink-0 px-4 pt-3 sm:px-6">
              <p className="mx-auto max-w-3xl rounded-lg border border-[var(--ui-error)]/30 bg-[var(--ui-error)]/5 px-3 py-2.5 text-sm text-[var(--ui-error)]">
                Failed to load on-device models (no server fallback): {modelError}
              </p>
            </div>
          ) : null}

          {modelNotice ? (
            <div className="shrink-0 px-4 pt-3 sm:px-6">
              <p
                role="status"
                className="mx-auto max-w-3xl rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2.5 text-sm text-[var(--ui-text-muted)]"
              >
                {modelNotice}
              </p>
            </div>
          ) : null}

          {emptyChat ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 sm:px-6">
              <div className="w-full max-w-2xl">
                <div className="mb-8 text-center">
                  <Logo size={36} className="mx-auto text-[var(--ui-primary)]" />
                  <h2 className="mt-4 text-2xl font-semibold text-[var(--ui-text-highlighted)]">
                    Chat privately with your documents
                  </h2>
                  <p className="mt-2 text-sm text-[var(--ui-text-muted)]">
                    The model and your PDFs stay on this device. Nothing leaves the browser.
                  </p>
                </div>

                {loading ? (
                  <div className="mb-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-3.5">
                    <ProgressBar
                      value={progress}
                      label={progressText || 'Loading on-device models…'}
                    />
                  </div>
                ) : null}

                {promptInput}

                {ingestMsg ? (
                  <p className="mt-2 text-center text-xs text-[var(--ui-text-muted)]">
                    {ingestMsg}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <Messages turns={session.turns} activity={activity} />
              <div className="shrink-0 px-4 pb-3 sm:px-6">
                <div className="mx-auto w-full max-w-3xl">
                  {promptInput}
                  <p className="mt-2 truncate text-center text-[11px] text-[var(--ui-text-dimmed)]">
                    {ingestMsg ??
                      'Runs fully on-device via WebGPU. Your documents never leave this browser.'}
                  </p>
                </div>
              </div>
            </>
          )}

          {dragActive ? (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--ui-primary)] bg-[var(--ui-bg)]/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-[var(--ui-primary)]">
                <IconFileText size={28} />
                <p className="text-sm font-medium">Drop your PDF to add it to this chat</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {benchOpen ? (
        <div className="hidden shrink-0 py-2 pr-2 lg:block">
          <div className="h-full overflow-hidden rounded-xl border border-[var(--ui-border)] shadow-sm">
            <Suspense fallback={null}>
              <BenchPanel
                worker={worker}
                chatId={session.id}
                chunks={chunks}
                modelId={MODEL_OPTIONS[selectedModel].modelId}
                modelLabel={MODEL_OPTIONS[selectedModel].label}
                adapterName={gpu.adapterName}
                ready={modelsReady && !chatBusy}
                onIngested={async () => {
                  await loadChatLibrary(session.id)
                  await refreshChats()
                }}
                onClose={() => setBenchOpen(false)}
              />
            </Suspense>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingConfirm?.kind === 'delete-chat'}
        title="Delete chat?"
        description={
          pendingConfirm?.kind === 'delete-chat'
            ? `“${pendingConfirm.chat.title}” and its PDFs will be removed from this device. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete chat"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (pendingConfirm?.kind === 'delete-chat') {
            void handleDeleteChatConfirmed(pendingConfirm.chat.id)
          }
          setPendingConfirm(null)
        }}
      />

      <ConfirmDialog
        open={pendingConfirm?.kind === 'clear-library'}
        title="Remove all PDFs from this chat?"
        description={
          pendingConfirm?.kind === 'clear-library'
            ? `All ${pendingConfirm.count} PDF${pendingConfirm.count === 1 ? '' : 's'} will be removed. Chat messages stay; re-upload to ask grounded questions again.`
            : ''
        }
        confirmLabel="Remove all"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          void handleClearLibraryConfirmed()
          setPendingConfirm(null)
        }}
      />
    </div>
  )
}
