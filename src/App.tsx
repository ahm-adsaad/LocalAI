import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chat } from './components/Chat'
import { ChatList } from './components/ChatList'
import { DocumentList } from './components/DocumentList'
import { ProgressBar } from './components/ProgressBar'
import { StatusBar, type ModelPhase } from './components/StatusBar'
import { WebGPUGate } from './components/WebGPUGate'
import { chunkText } from './lib/chunking'
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
  saveDocumentWithChunks,
  setActiveChatId,
  setPreferredModelTier,
  titleFromDocumentName,
  titleFromTurns,
} from './lib/db'
import { downloadChatMarkdown } from './lib/exportChat'
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  recommendModel,
  resolveModelOptionId,
  type ModelOptionId,
} from './lib/models'
import { extractPdfText } from './lib/pdf'
import { buildPlainChatMessages, buildRagMessages } from './lib/prompt'
import { embeddingQueryFor, selectRagSources } from './lib/rag'
import type { ChatSession, ChatTurn, DocumentMeta, RankedChunk, StoredChunk } from './lib/types'
import { TOP_K_OVERVIEW } from './lib/types'
import { checkWebGPU, type WebGPUStatus } from './lib/webgpu'
import { getWorkerClient } from './lib/workerClient'

function uid() {
  return crypto.randomUUID()
}

/** Survive React StrictMode remounts so we only download/load weights once. */
let modelBootPromise: Promise<ModelOptionId> | null = null
type BootProgress = (p: { progress: number; text: string }) => void
const bootProgressSubs = new Set<BootProgress>()

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

export default function App() {
  const [gpu, setGpu] = useState<WebGPUStatus | null>(null)
  const [phase, setPhase] = useState<ModelPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [modelError, setModelError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ModelOptionId>(DEFAULT_MODEL)
  const [recommendedModel, setRecommendedModel] = useState<ModelOptionId>(DEFAULT_MODEL)
  const [modelSwitching, setModelSwitching] = useState(false)

  const [documents, setDocuments] = useState<DocumentMeta[]>([])
  const [chunks, setChunks] = useState<StoredChunk[]>([])
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const [ingestBusy, setIngestBusy] = useState(false)
  const [ingestMsg, setIngestMsg] = useState<string | null>(null)

  const [chats, setChats] = useState<ChatSession[]>([])
  const [session, setSession] = useState<ChatSession>(() => newSession())
  const [generating, setGenerating] = useState(false)
  const [activity, setActivity] = useState<string | null>(null)

  const sessionRef = useRef(session)
  sessionRef.current = session

  const worker = useMemo(() => getWorkerClient(), [])

  const loadLlm = useCallback(
    async (next: ModelOptionId, opts?: { switching?: boolean }) => {
      const spec = MODEL_OPTIONS[next]
      if (opts?.switching) setModelSwitching(true)
      else setPhase('loading-llm')
      setProgress(0)
      setProgressText(`Loading ${spec.label} · ${spec.modelId}…`)
      await worker.initLLM(
        { modelId: spec.modelId, contextWindow: spec.contextWindow },
        (p) => {
          setProgress(p.progress)
          setProgressText(p.text)
        },
      )
      setSelectedModel(next)
      await setPreferredModelTier(next)
      if (opts?.switching) setModelSwitching(false)
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
            const initial = resolveModelOptionId(saved) ?? suggested
            const spec = MODEL_OPTIONS[initial]
            const fanout: BootProgress = (p) => {
              for (const cb of bootProgressSubs) cb(p)
            }
            fanout({ progress: 0.02, text: `Loading ${spec.label} · ${spec.modelId}…` })
            await worker.initLLM(
              { modelId: spec.modelId, contextWindow: spec.contextWindow },
              fanout,
            )
            await setPreferredModelTier(initial)
            fanout({ progress: 0.05, text: 'Loading embedding model…' })
            await worker.initEmbedder(fanout)
            return initial
          })().catch((err) => {
            modelBootPromise = null
            throw err
          })
        }

        const initial = await modelBootPromise
        if (cancelled) return

        setSelectedModel(initial)
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

      const { text, pageCount } = await extractPdfText(file)
      if (!text.trim()) {
        throw new Error('No extractable text in this PDF (it may be image-only).')
      }

      const parts = chunkText(text)
      setIngestMsg(`Embedding ${parts.length} chunks on-device…`)

      const embeddings = await worker.embed(parts)
      const documentId = uid()
      const stored: StoredChunk[] = parts.map((part, i) => ({
        id: `${documentId}-${i}`,
        documentId,
        documentName: file.name,
        index: i,
        text: part,
        embedding: embeddings[i] ?? [],
      }))

      const meta: DocumentMeta = {
        id: documentId,
        chatId: chat.id,
        name: file.name,
        pageCount,
        chunkCount: stored.length,
        createdAt: Date.now(),
        sizeBytes: file.size,
      }

      await saveDocumentWithChunks(meta, stored)

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

  async function handleDeleteDoc(id: string) {
    await deleteDocument(id)
    await loadChatLibrary(sessionRef.current.id)
    await refreshChats()
  }

  async function handleClearLibrary() {
    const chatId = sessionRef.current.id
    const n = documents.length
    if (n === 0) return
    if (
      !window.confirm(
        `Remove all ${n} PDF${n === 1 ? '' : 's'} from this chat? Chat messages stay; re-upload to ask grounded questions again.`,
      )
    ) {
      return
    }
    await clearChatLibrary(chatId)
    await loadChatLibrary(chatId)
    await refreshChats()
    setIngestMsg('Cleared this chat’s PDF library.')
  }

  function handleExportChat() {
    downloadChatMarkdown(sessionRef.current)
  }

  async function handleNewChat() {
    if (generating) worker.abort()
    const fresh = newSession()
    await saveChat(fresh)
    await setActiveChatId(fresh.id)
    setSession(fresh)
    setDocuments([])
    setChunks([])
    setIngestMsg(null)
    await refreshChats()
  }

  async function handleSelectChat(id: string) {
    if (id === session.id) return
    if (generating) worker.abort()
    const existing = await getChat(id)
    if (!existing) return
    setSession(existing)
    await setActiveChatId(id)
    setIngestMsg(null)
    await loadChatLibrary(id)
  }

  async function handleDeleteChat(id: string) {
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
      let sources: RankedChunk[] = []
      let messages
      const historyTurns = sessionRef.current.turns.filter((t) => !t.streaming)

      // RAG only over PDFs attached to this chat.
      if (chunks.length > 0) {
        setActivity('Retrieving…')
        const byId = new Map(chunks.map((c) => [c.id, c]))
        const scored = await worker.search(
          embeddingQueryFor(text),
          chunks.map((c) => ({ id: c.id, embedding: c.embedding })),
          TOP_K_OVERVIEW,
        )
        const ranked: RankedChunk[] = scored.flatMap((s) => {
          const c = byId.get(s.id)
          if (!c) return []
          return [
            {
              id: c.id,
              documentId: c.documentId,
              documentName: c.documentName,
              text: c.text,
              score: s.score,
            },
          ]
        })
        sources = selectRagSources(text, chunks, ranked)
        messages = buildRagMessages(text, sources)
      } else {
        messages = buildPlainChatMessages(
          historyTurns.map((t) => ({
            role: t.role as 'user' | 'assistant',
            content: t.content,
          })),
          text,
        )
      }

      setActivity('Generating…')
      await worker.generate(messages, { stream: true, onToken })
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
                  sources: sources.length > 0 ? sources : undefined,
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

  if (!gpu) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-[var(--color-muted)]">
        Checking WebGPU…
      </div>
    )
  }

  if (!gpu.ok) {
    return <WebGPUGate status={gpu} />
  }

  const modelsReady = phase === 'ready'
  const chatBusy = generating || ingestBusy

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <StatusBar
        webgpuOk
        adapterName={gpu.adapterName}
        vramMb={gpu.vramMb}
        vramKnown={gpu.vramSource === 'adapter-info'}
        phase={phase}
        progressText={progressText}
        documentCount={documents.length}
        chunkCount={chunks.length}
        modelId={selectedModel}
        recommendedModel={recommendedModel}
        modelSwitching={modelSwitching}
        onModelChange={handleModelChange}
      />

      {(phase === 'loading-llm' || phase === 'loading-embed') && (
        <div className="mx-auto w-full max-w-6xl shrink-0 px-4 pt-4 sm:px-6">
          <ProgressBar value={progress} label={progressText || 'Loading…'} />
        </div>
      )}

      {phase === 'error' && (
        <div className="mx-auto w-full max-w-6xl shrink-0 px-4 pt-4 sm:px-6">
          <p className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-panel)] p-3 text-sm text-[var(--color-danger)]">
            Failed to load on-device models (no server fallback): {modelError}
          </p>
        </div>
      )}

      <main className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 gap-6 overflow-hidden px-4 py-4 lg:grid-cols-[280px_1fr] sm:px-6">
        <aside className="flex min-h-0 flex-col overflow-y-auto overscroll-contain lg:overflow-hidden">
          <DocumentList
            documents={documents}
            busy={ingestBusy || !modelsReady}
            onUpload={handleUpload}
            onDelete={handleDeleteDoc}
            onClearLibrary={handleClearLibrary}
          />
          {ingestMsg ? (
            <p className="mt-2 shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-muted)]">
              {ingestMsg}
            </p>
          ) : null}
          <ChatList
            chats={chats}
            activeId={session.id}
            docCounts={docCounts}
            busy={chatBusy}
            onSelect={handleSelectChat}
            onNew={handleNewChat}
            onDelete={handleDeleteChat}
          />
        </aside>

        <div className="min-h-0 min-w-0">
          <Chat
            turns={session.turns}
            title={session.title}
            disabled={!modelsReady}
            generating={generating}
            activity={activity}
            onSend={handleSend}
            onStop={() => worker.abort()}
            onExport={handleExportChat}
            placeholder={
              modelsReady
                ? documents.length > 0
                  ? 'Ask a question about this chat’s PDFs…'
                  : 'Add a PDF to this chat, or chat without one…'
                : 'Waiting for models…'
            }
          />
        </div>
      </main>
    </div>
  )
}
