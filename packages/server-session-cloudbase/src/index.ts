import type {
  AppSession,
  CreateStoredSessionInput,
  CreateStoredSessionResult,
  ExpireStoredSessionInput,
  RotateStoredSessionInput,
  RotateStoredSessionResult,
  SessionStore,
  TouchStoredSessionInput,
  UserSessionFilter,
} from '@yunlefun/server-session'
import { createHash } from 'node:crypto'
import { SessionError } from '@yunlefun/server-session'

/** Default server-only session collection. */
export const CLOUD_BASE_SESSION_COLLECTION = 'ylf_app_sessions'

/** Supported persisted schema version. */
export const CLOUD_BASE_SESSION_SCHEMA_VERSION = 1

/** One field in a CloudBase composite index. */
export interface CloudBaseSessionIndexField {
  field: string
  order: 'asc' | 'desc'
}

/** Declarative index required by the session adapter and sweeper. */
export interface CloudBaseSessionIndexDefinition {
  name: string
  unique: boolean
  fields: readonly CloudBaseSessionIndexField[]
  purpose: string
}

/** Checked-in resource contract. Resource creation remains a separately approved operation. */
export const CLOUD_BASE_SESSION_INDEXES: readonly CloudBaseSessionIndexDefinition[] = [
  {
    name: 'app_user_status_created',
    unique: false,
    fields: [
      { field: 'appId', order: 'asc' },
      { field: 'userId', order: 'asc' },
      { field: 'status', order: 'asc' },
      { field: 'createdAt', order: 'desc' },
    ],
    purpose: 'active device listing and bounded eviction inspection',
  },
  {
    name: 'status_absolute_expiry',
    unique: false,
    fields: [
      { field: 'status', order: 'asc' },
      { field: 'absoluteExpiresAt', order: 'asc' },
    ],
    purpose: 'absolute-expiry sweeping',
  },
  {
    name: 'status_idle_expiry',
    unique: false,
    fields: [
      { field: 'status', order: 'asc' },
      { field: 'idleExpiresAt', order: 'asc' },
    ],
    purpose: 'idle-expiry sweeping',
  },
] as const

/** Full collection manifest used by provisioning review and tests. */
export const CLOUD_BASE_SESSION_COLLECTION_MANIFEST = {
  collection: CLOUD_BASE_SESSION_COLLECTION,
  access: 'server-only',
  browserRead: false,
  browserWrite: false,
  indexes: CLOUD_BASE_SESSION_INDEXES,
  retention: {
    terminalRecordDays: 90,
  },
} as const

/** Minimal CloudBase document result supported by both transaction and regular reads. */
export interface CloudBaseGetResult {
  data?: unknown
  code?: string | number
  message?: string
  requestId?: string
}

/** Minimal document reference used by this adapter. */
export interface CloudBaseDocumentReference {
  get: () => Promise<CloudBaseGetResult>
  set: (data: Record<string, unknown>) => Promise<unknown>
  update: (data: Record<string, unknown>) => Promise<unknown>
  remove: () => Promise<unknown>
}

/** Minimal query surface used by this adapter. */
export interface CloudBaseQueryReference {
  orderBy: (field: string, direction: 'asc' | 'desc') => CloudBaseQueryReference
  limit: (limit: number) => CloudBaseQueryReference
  get: () => Promise<CloudBaseGetResult>
}

/** Minimal collection surface used by this adapter. */
export interface CloudBaseCollectionReference {
  doc: (id: string) => CloudBaseDocumentReference
  where: (condition: Record<string, unknown>) => CloudBaseQueryReference
}

/** Minimal transaction surface used by this adapter. CloudBase transactions use document reads only. */
export interface CloudBaseTransaction {
  collection: (name: string) => CloudBaseCollectionReference
}

/** Structural CloudBase Node SDK database contract accepted by the adapter. */
export interface CloudBaseDatabase {
  command: {
    lte: (value: number) => unknown
  }
  collection: (name: string) => CloudBaseCollectionReference
  runTransaction: <T>(operation: (transaction: CloudBaseTransaction) => Promise<T>, retryTimes?: number) => Promise<T>
}

/** Construction options for {@link CloudBaseSessionStore}. */
export interface CloudBaseSessionStoreOptions {
  database: CloudBaseDatabase
  collectionName?: string
  transactionRetryTimes?: number
}

/** Bounded expiry sweep request. */
export interface SweepExpiredSessionsInput {
  now: number
  limit?: number
}

/** Expiry sweep outcome. */
export interface SweepExpiredSessionsResult {
  scanned: number
  expired: number
}

interface AppSessionDocument extends Record<string, unknown> {
  _id: string
  recordType: 'session'
  schemaVersion: typeof CLOUD_BASE_SESSION_SCHEMA_VERSION
  appId: string
  userId: string
  status: AppSession['status']
  createdAt: number
  rotatedAt: number
  lastSeenAt: number
  idleExpiresAt: number
  absoluteExpiresAt: number
  version: number
}

interface SessionIndexEntry extends Record<string, unknown> {
  id: string
  createdAt: number
}

interface UserSessionIndexDocument extends Record<string, unknown> {
  _id: string
  recordType: 'user_index'
  schemaVersion: typeof CLOUD_BASE_SESSION_SCHEMA_VERSION
  appId: string
  userId: string
  active: SessionIndexEntry[]
  version: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string')
    throw new SessionError('STORE_ERROR', `invalid session field: ${key}`)
  return value
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (!Number.isSafeInteger(value))
    throw new SessionError('STORE_ERROR', `invalid session field: ${key}`)
  return value as number
}

function firstDocument(result: CloudBaseGetResult): Record<string, unknown> | null {
  assertCloudBaseResult(result)
  const data = result.data
  if (Array.isArray(data))
    return isRecord(data[0]) ? data[0] : null
  return isRecord(data) && Object.keys(data).length > 0 ? data : null
}

function documentList(result: CloudBaseGetResult): Record<string, unknown>[] {
  assertCloudBaseResult(result)
  return Array.isArray(result.data) ? result.data.filter(isRecord) : []
}

function assertCloudBaseResult(result: unknown, requireUpdated = false): void {
  if (!isRecord(result))
    return
  if (result.code !== undefined && result.code !== 0 && result.code !== '0')
    throw new SessionError('STORE_ERROR', typeof result.message === 'string' ? result.message : 'CloudBase database operation failed')
  if (!requireUpdated)
    return
  const updated = result.updated ?? result.modifiedCount
  if (updated !== undefined && (!Number.isSafeInteger(updated) || Number(updated) < 1))
    throw new SessionError('SESSION_CONFLICT', 'CloudBase session update did not modify a document')
}

async function setDocument(ref: CloudBaseDocumentReference, data: Record<string, unknown>): Promise<void> {
  assertCloudBaseResult(await ref.set(data))
}

async function updateDocument(ref: CloudBaseDocumentReference, data: Record<string, unknown>): Promise<void> {
  assertCloudBaseResult(await ref.update(data), true)
}

function sessionToDocument(session: AppSession): AppSessionDocument {
  return {
    _id: session.id,
    recordType: 'session',
    schemaVersion: CLOUD_BASE_SESSION_SCHEMA_VERSION,
    appId: session.appId,
    userId: session.userId,
    status: session.status,
    createdAt: session.createdAt,
    rotatedAt: session.rotatedAt,
    lastSeenAt: session.lastSeenAt,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    ...(session.revokedAt === undefined ? {} : { revokedAt: session.revokedAt }),
    ...(session.deviceLabel === undefined ? {} : { deviceLabel: session.deviceLabel }),
    ...(session.userAgentHash === undefined ? {} : { userAgentHash: session.userAgentHash }),
    ...(session.ipPrefixHash === undefined ? {} : { ipPrefixHash: session.ipPrefixHash }),
    version: session.version,
  }
}

function writableDocument(record: Record<string, unknown>): Record<string, unknown> {
  const { _id: _documentId, ...data } = record
  return data
}

function documentToSession(record: Record<string, unknown>): AppSession {
  if (record.recordType !== 'session' || record.schemaVersion !== CLOUD_BASE_SESSION_SCHEMA_VERSION)
    throw new SessionError('STORE_ERROR', 'unsupported session document')
  const status = readString(record, 'status')
  if (status !== 'active' && status !== 'revoked' && status !== 'expired')
    throw new SessionError('STORE_ERROR', 'invalid session status')
  const optionalString = (key: string): string | undefined => {
    const value = record[key]
    if (value === undefined)
      return undefined
    if (typeof value !== 'string')
      throw new SessionError('STORE_ERROR', `invalid session field: ${key}`)
    return value
  }
  const revokedAt = record.revokedAt === undefined ? undefined : readNumber(record, 'revokedAt')
  const deviceLabel = optionalString('deviceLabel')
  const userAgentHash = optionalString('userAgentHash')
  const ipPrefixHash = optionalString('ipPrefixHash')
  return {
    id: readString(record, '_id'),
    appId: readString(record, 'appId'),
    userId: readString(record, 'userId'),
    status,
    createdAt: readNumber(record, 'createdAt'),
    rotatedAt: readNumber(record, 'rotatedAt'),
    lastSeenAt: readNumber(record, 'lastSeenAt'),
    idleExpiresAt: readNumber(record, 'idleExpiresAt'),
    absoluteExpiresAt: readNumber(record, 'absoluteExpiresAt'),
    ...(revokedAt === undefined ? {} : { revokedAt }),
    ...(deviceLabel === undefined ? {} : { deviceLabel }),
    ...(userAgentHash === undefined ? {} : { userAgentHash }),
    ...(ipPrefixHash === undefined ? {} : { ipPrefixHash }),
    version: readNumber(record, 'version'),
  }
}

function indexDocumentId(filter: UserSessionFilter): string {
  return `user.${createHash('sha256').update(filter.appId).update('\0').update(filter.userId).digest('hex')}`
}

function emptyIndex(filter: UserSessionFilter): UserSessionIndexDocument {
  return {
    _id: indexDocumentId(filter),
    recordType: 'user_index',
    schemaVersion: CLOUD_BASE_SESSION_SCHEMA_VERSION,
    appId: filter.appId,
    userId: filter.userId,
    active: [],
    version: 0,
  }
}

function readIndex(record: Record<string, unknown> | null, filter: UserSessionFilter): UserSessionIndexDocument {
  if (!record)
    return emptyIndex(filter)
  if (
    record.recordType !== 'user_index'
    || record.schemaVersion !== CLOUD_BASE_SESSION_SCHEMA_VERSION
    || record.appId !== filter.appId
    || record.userId !== filter.userId
    || !Array.isArray(record.active)
  ) {
    throw new SessionError('STORE_ERROR', 'invalid user session index document')
  }
  const active = record.active.map((entry) => {
    if (!isRecord(entry))
      throw new SessionError('STORE_ERROR', 'invalid user session index entry')
    return { id: readString(entry, 'id'), createdAt: readNumber(entry, 'createdAt') }
  })
  return {
    _id: readString(record, '_id'),
    recordType: 'user_index',
    schemaVersion: CLOUD_BASE_SESSION_SCHEMA_VERSION,
    appId: filter.appId,
    userId: filter.userId,
    active,
    version: readNumber(record, 'version'),
  }
}

function nextIndex(index: UserSessionIndexDocument, active: SessionIndexEntry[]): UserSessionIndexDocument {
  return { ...index, active, version: index.version + 1 }
}

function sortedUniqueEntries(entries: readonly SessionIndexEntry[]): SessionIndexEntry[] {
  const unique = new Map<string, SessionIndexEntry>()
  for (const entry of entries)
    unique.set(entry.id, { ...entry })
  return [...unique.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

function asStoreError(error: unknown): never {
  if (error instanceof SessionError)
    throw error
  throw new SessionError('STORE_ERROR', 'CloudBase session store operation failed', { cause: error })
}

/** Transactional CloudBase implementation of the framework-neutral session store. */
export class CloudBaseSessionStore implements SessionStore {
  readonly #database: CloudBaseDatabase
  readonly #collectionName: string
  readonly #transactionRetryTimes: number

  constructor(options: CloudBaseSessionStoreOptions) {
    if (options.collectionName !== undefined && !/^[\w-]{1,64}$/.test(options.collectionName))
      throw new SessionError('INVALID_INPUT', 'invalid CloudBase collectionName')
    if (options.transactionRetryTimes !== undefined && (!Number.isSafeInteger(options.transactionRetryTimes) || options.transactionRetryTimes < 1))
      throw new SessionError('INVALID_INPUT', 'transactionRetryTimes must be a positive integer')
    this.#database = options.database
    this.#collectionName = options.collectionName ?? CLOUD_BASE_SESSION_COLLECTION
    this.#transactionRetryTimes = options.transactionRetryTimes ?? 3
  }

  async createAndEnforceLimit(input: CreateStoredSessionInput): Promise<CreateStoredSessionResult> {
    if (!Number.isSafeInteger(input.maxSessions) || input.maxSessions < 1 || input.maxSessions > 32)
      throw new SessionError('INVALID_INPUT', 'CloudBase maxSessions must be between 1 and 32')
    try {
      return await this.#database.runTransaction(async (transaction) => {
        const collection = transaction.collection(this.#collectionName)
        if (firstDocument(await collection.doc(input.session.id).get()))
          throw new SessionError('SESSION_CONFLICT', 'session identifier already exists')
        const filter = { appId: input.session.appId, userId: input.session.userId }
        const indexRef = collection.doc(indexDocumentId(filter))
        const index = readIndex(firstDocument(await indexRef.get()), filter)
        const candidates = sortedUniqueEntries([...index.active, { id: input.session.id, createdAt: input.session.createdAt }])
        const evicted = candidates.slice(0, Math.max(0, candidates.length - input.maxSessions))
        const active = candidates.slice(evicted.length)
        for (const entry of evicted) {
          const existing = firstDocument(await collection.doc(entry.id).get())
          if (!existing)
            continue
          const session = documentToSession(existing)
          if (session.status === 'active') {
            await updateDocument(collection.doc(entry.id), writableDocument(sessionToDocument({
              ...session,
              status: 'revoked',
              revokedAt: input.session.createdAt,
              version: session.version + 1,
            })))
          }
        }
        await setDocument(collection.doc(input.session.id), writableDocument(sessionToDocument(input.session)))
        await setDocument(indexRef, writableDocument(nextIndex(index, active)))
        return { session: input.session, revokedSessionIds: evicted.map(entry => entry.id) }
      }, this.#transactionRetryTimes)
    }
    catch (error) {
      return asStoreError(error)
    }
  }

  async findById(sessionId: string): Promise<AppSession | null> {
    try {
      const record = firstDocument(await this.#database.collection(this.#collectionName).doc(sessionId).get())
      return record ? documentToSession(record) : null
    }
    catch (error) {
      return asStoreError(error)
    }
  }

  async touch(input: TouchStoredSessionInput): Promise<AppSession | null> {
    try {
      return await this.#database.runTransaction(async (transaction) => {
        const ref = transaction.collection(this.#collectionName).doc(input.sessionId)
        const record = firstDocument(await ref.get())
        if (!record)
          return null
        const session = documentToSession(record)
        if (session.status !== 'active' || session.version !== input.expectedVersion)
          return null
        const touched = {
          ...session,
          lastSeenAt: input.lastSeenAt,
          idleExpiresAt: Math.min(input.idleExpiresAt, session.absoluteExpiresAt),
          version: session.version + 1,
        }
        await updateDocument(ref, writableDocument(sessionToDocument(touched)))
        return touched
      }, this.#transactionRetryTimes)
    }
    catch (error) {
      return asStoreError(error)
    }
  }

  async rotate(input: RotateStoredSessionInput): Promise<RotateStoredSessionResult | null> {
    if (!Number.isSafeInteger(input.maxSessions) || input.maxSessions < 1 || input.maxSessions > 32)
      throw new SessionError('INVALID_INPUT', 'CloudBase maxSessions must be between 1 and 32')
    try {
      return await this.#database.runTransaction(async (transaction) => {
        const collection = transaction.collection(this.#collectionName)
        const currentRecord = firstDocument(await collection.doc(input.currentSessionId).get())
        if (!currentRecord || firstDocument(await collection.doc(input.nextSession.id).get()))
          return null
        const current = documentToSession(currentRecord)
        if (current.status !== 'active' || current.version !== input.expectedVersion)
          return null
        const filter = { appId: current.appId, userId: current.userId }
        const indexRef = collection.doc(indexDocumentId(filter))
        const index = readIndex(firstDocument(await indexRef.get()), filter)
        const withoutCurrent = index.active.filter(entry => entry.id !== current.id)
        const candidates = sortedUniqueEntries([...withoutCurrent, { id: input.nextSession.id, createdAt: input.nextSession.createdAt }])
        const evicted = candidates.slice(0, Math.max(0, candidates.length - input.maxSessions))
        const active = candidates.slice(evicted.length)
        await updateDocument(collection.doc(current.id), writableDocument(sessionToDocument({
          ...current,
          status: 'revoked',
          revokedAt: input.rotatedAt,
          version: current.version + 1,
        })))
        for (const entry of evicted) {
          const existing = firstDocument(await collection.doc(entry.id).get())
          if (!existing)
            continue
          const session = documentToSession(existing)
          if (session.status === 'active') {
            await updateDocument(collection.doc(entry.id), writableDocument(sessionToDocument({
              ...session,
              status: 'revoked',
              revokedAt: input.rotatedAt,
              version: session.version + 1,
            })))
          }
        }
        await setDocument(collection.doc(input.nextSession.id), writableDocument(sessionToDocument(input.nextSession)))
        await setDocument(indexRef, writableDocument(nextIndex(index, active)))
        return {
          session: input.nextSession,
          revokedSessionIds: [...new Set([current.id, ...evicted.map(entry => entry.id)])],
        }
      }, this.#transactionRetryTimes)
    }
    catch (error) {
      return asStoreError(error)
    }
  }

  async expire(input: ExpireStoredSessionInput): Promise<boolean> {
    try {
      return await this.#database.runTransaction(async (transaction) => {
        const collection = transaction.collection(this.#collectionName)
        const ref = collection.doc(input.sessionId)
        const record = firstDocument(await ref.get())
        if (!record)
          return false
        const session = documentToSession(record)
        if (
          session.status !== 'active'
          || session.version !== input.expectedVersion
          || (input.expiredAt < session.idleExpiresAt && input.expiredAt < session.absoluteExpiresAt)
        ) {
          return false
        }
        await updateDocument(ref, writableDocument(sessionToDocument({ ...session, status: 'expired', version: session.version + 1 })))
        await this.#removeFromIndex(transaction, session)
        return true
      }, this.#transactionRetryTimes)
    }
    catch (error) {
      return asStoreError(error)
    }
  }

  async revoke(sessionId: string, revokedAt: number): Promise<boolean> {
    try {
      return await this.#database.runTransaction(async (transaction) => {
        const collection = transaction.collection(this.#collectionName)
        const ref = collection.doc(sessionId)
        const record = firstDocument(await ref.get())
        if (!record)
          return false
        const session = documentToSession(record)
        if (session.status !== 'active')
          return true
        await updateDocument(ref, writableDocument(sessionToDocument({ ...session, status: 'revoked', revokedAt, version: session.version + 1 })))
        await this.#removeFromIndex(transaction, session)
        return true
      }, this.#transactionRetryTimes)
    }
    catch (error) {
      return asStoreError(error)
    }
  }

  async revokeOthers(filter: UserSessionFilter, currentSessionId: string, revokedAt: number): Promise<number> {
    try {
      return await this.#database.runTransaction(async (transaction) => {
        const collection = transaction.collection(this.#collectionName)
        const indexRef = collection.doc(indexDocumentId(filter))
        const index = readIndex(firstDocument(await indexRef.get()), filter)
        const others = index.active.filter(entry => entry.id !== currentSessionId)
        for (const entry of others) {
          const record = firstDocument(await collection.doc(entry.id).get())
          if (!record)
            continue
          const session = documentToSession(record)
          if (session.status === 'active') {
            await updateDocument(collection.doc(entry.id), writableDocument(sessionToDocument({
              ...session,
              status: 'revoked',
              revokedAt,
              version: session.version + 1,
            })))
          }
        }
        await setDocument(indexRef, writableDocument(nextIndex(index, index.active.filter(entry => entry.id === currentSessionId))))
        return others.length
      }, this.#transactionRetryTimes)
    }
    catch (error) {
      return asStoreError(error)
    }
  }

  async listForUser(filter: UserSessionFilter): Promise<AppSession[]> {
    try {
      const result = await this.#database.collection(this.#collectionName)
        .where({ appId: filter.appId, userId: filter.userId, status: 'active' })
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get()
      return documentList(result).map(documentToSession)
    }
    catch (error) {
      return asStoreError(error)
    }
  }

  async #removeFromIndex(transaction: CloudBaseTransaction, session: AppSession): Promise<void> {
    const filter = { appId: session.appId, userId: session.userId }
    const indexRef = transaction.collection(this.#collectionName).doc(indexDocumentId(filter))
    const index = readIndex(firstDocument(await indexRef.get()), filter)
    await setDocument(indexRef, writableDocument(nextIndex(index, index.active.filter(entry => entry.id !== session.id))))
  }
}

/** Bounded expiry worker. Queries use the checked-in status/deadline indexes. */
export class CloudBaseSessionSweeper {
  readonly #database: CloudBaseDatabase
  readonly #store: CloudBaseSessionStore
  readonly #collectionName: string

  constructor(options: CloudBaseSessionStoreOptions) {
    this.#database = options.database
    this.#store = new CloudBaseSessionStore(options)
    this.#collectionName = options.collectionName ?? CLOUD_BASE_SESSION_COLLECTION
  }

  /** Expire due active sessions. Concurrent activity wins through optimistic versions. */
  async sweepExpired(input: SweepExpiredSessionsInput): Promise<SweepExpiredSessionsResult> {
    const limit = input.limit ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new SessionError('INVALID_INPUT', 'sweep limit must be between 1 and 500')
    const collection = this.#database.collection(this.#collectionName)
    const perQuery = Math.min(limit, 500)
    try {
      const [absolute, idle] = await Promise.all([
        collection
          .where({ status: 'active', absoluteExpiresAt: this.#database.command.lte(input.now) })
          .orderBy('absoluteExpiresAt', 'asc')
          .limit(perQuery)
          .get(),
        collection
          .where({ status: 'active', idleExpiresAt: this.#database.command.lte(input.now) })
          .orderBy('idleExpiresAt', 'asc')
          .limit(perQuery)
          .get(),
      ])
      const candidates = new Map<string, AppSession>()
      for (const record of [...documentList(absolute), ...documentList(idle)]) {
        const session = documentToSession(record)
        candidates.set(session.id, session)
      }
      const selected = [...candidates.values()].slice(0, limit)
      let expired = 0
      for (const session of selected) {
        if (await this.#store.expire({
          sessionId: session.id,
          expectedVersion: session.version,
          expiredAt: input.now,
        })) {
          expired++
        }
      }
      return { scanned: selected.length, expired }
    }
    catch (error) {
      return asStoreError(error)
    }
  }
}
