import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ChatSession, DocumentMeta, StoredChunk } from './types'

interface LocalAIDB extends DBSchema {
  documents: {
    key: string
    value: DocumentMeta
    indexes: { 'by-chat': string }
  }
  chunks: {
    key: string
    value: StoredChunk
    indexes: { 'by-document': string }
  }
  chats: {
    key: string
    value: ChatSession
    indexes: { 'by-updated': number }
  }
  meta: {
    key: string
    value: { key: string; value: string }
  }
}

const DB_NAME = 'localai-workspace'
const DB_VERSION = 3
const ACTIVE_CHAT_KEY = 'activeChatId'
const MODEL_TIER_KEY = 'modelTier'

let dbPromise: Promise<IDBPDatabase<LocalAIDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<LocalAIDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          db.createObjectStore('documents', { keyPath: 'id' })
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' })
          chunks.createIndex('by-document', 'documentId')
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('chats')) {
            const chats = db.createObjectStore('chats', { keyPath: 'id' })
            chats.createIndex('by-updated', 'updatedAt')
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' })
          }
        }
        if (oldVersion < 3) {
          const docs = transaction.objectStore('documents')
          if (!docs.indexNames.contains('by-chat')) {
            docs.createIndex('by-chat', 'chatId')
          }
        }
      },
    })
  }
  return dbPromise
}

/**
 * Older installs had global docs with no chatId. Attach orphans to a chat so
 * they still show up somewhere after the per-chat library change.
 */
export async function adoptOrphanDocuments(chatId: string): Promise<number> {
  const db = await getDb()
  const all = await db.getAll('documents')
  let n = 0
  const tx = db.transaction('documents', 'readwrite')
  for (const doc of all) {
    if (!doc.chatId) {
      await tx.store.put({ ...doc, chatId })
      n += 1
    }
  }
  await tx.done
  return n
}

export async function listDocumentsForChat(chatId: string): Promise<DocumentMeta[]> {
  const db = await getDb()
  const docs = await db.getAllFromIndex('documents', 'by-chat', chatId)
  return docs.sort((a, b) => b.createdAt - a.createdAt)
}

export async function countDocumentsByChat(): Promise<Record<string, number>> {
  const db = await getDb()
  const docs = await db.getAll('documents')
  const counts: Record<string, number> = {}
  for (const d of docs) {
    if (!d.chatId) continue
    counts[d.chatId] = (counts[d.chatId] ?? 0) + 1
  }
  return counts
}

export async function getChunksForChat(chatId: string): Promise<StoredChunk[]> {
  const docs = await listDocumentsForChat(chatId)
  if (docs.length === 0) return []
  const db = await getDb()
  const out: StoredChunk[] = []
  for (const doc of docs) {
    const parts = await db.getAllFromIndex('chunks', 'by-document', doc.id)
    out.push(...parts)
  }
  return out
}

export async function saveDocumentWithChunks(
  doc: DocumentMeta,
  chunks: StoredChunk[],
): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['documents', 'chunks'], 'readwrite')
  await tx.objectStore('documents').put(doc)
  for (const chunk of chunks) {
    await tx.objectStore('chunks').put(chunk)
  }
  await tx.done
}

export async function deleteDocument(documentId: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['documents', 'chunks'], 'readwrite')
  await tx.objectStore('documents').delete(documentId)
  const index = tx.objectStore('chunks').index('by-document')
  let cursor = await index.openCursor(documentId)
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

/** Remove a chat and every PDF/chunk that belonged only to it. */
export async function deleteChatCascade(chatId: string): Promise<void> {
  const docs = await listDocumentsForChat(chatId)
  for (const doc of docs) {
    await deleteDocument(doc.id)
  }
  const db = await getDb()
  await db.delete('chats', chatId)
}

function persistableTurns(session: ChatSession): ChatSession {
  return {
    ...session,
    turns: session.turns
      .filter((t) => !t.streaming)
      .map(({ streaming: _s, ...rest }) => rest),
  }
}

export async function listChats(): Promise<ChatSession[]> {
  const db = await getDb()
  const chats = await db.getAll('chats')
  return chats.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getChat(id: string): Promise<ChatSession | undefined> {
  const db = await getDb()
  return db.get('chats', id)
}

export async function saveChat(session: ChatSession): Promise<void> {
  const db = await getDb()
  await db.put('chats', persistableTurns(session))
}

export async function getActiveChatId(): Promise<string | null> {
  const db = await getDb()
  const row = await db.get('meta', ACTIVE_CHAT_KEY)
  return row?.value ?? null
}

export async function setActiveChatId(id: string | null): Promise<void> {
  const db = await getDb()
  if (id === null) {
    await db.delete('meta', ACTIVE_CHAT_KEY)
    return
  }
  await db.put('meta', { key: ACTIVE_CHAT_KEY, value: id })
}

export async function getPreferredModelTier(): Promise<string | null> {
  const db = await getDb()
  const row = await db.get('meta', MODEL_TIER_KEY)
  return row?.value ?? null
}

export async function setPreferredModelTier(tier: string): Promise<void> {
  const db = await getDb()
  await db.put('meta', { key: MODEL_TIER_KEY, value: tier })
}

export function titleFromTurns(turns: ChatSession['turns']): string {
  const firstUser = turns.find((t) => t.role === 'user' && t.content.trim())
  if (!firstUser) return 'New chat'
  const t = firstUser.content.trim().replace(/\s+/g, ' ')
  return t.length > 48 ? `${t.slice(0, 48)}…` : t
}

/** Prefer a PDF filename as the chat title when the thread is still empty. */
export function titleFromDocumentName(name: string): string {
  const base = name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  if (!base) return 'New chat'
  return base.length > 48 ? `${base.slice(0, 48)}…` : base
}
