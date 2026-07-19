import type {
  CloudBaseCollectionReference,
  CloudBaseDatabase,
  CloudBaseDocumentReference,
  CloudBaseGetResult,
  CloudBaseQueryReference,
  CloudBaseTransaction,
} from '../src'
import { ServerSessionService } from '@yunlefun/server-session'
import { describe, expect, it } from 'vitest'
import {
  CLOUD_BASE_SESSION_COLLECTION_MANIFEST,
  CloudBaseSessionStore,
  CloudBaseSessionSweeper,
} from '../src'

interface LessThanOrEqual {
  $lte: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isLessThanOrEqual(value: unknown): value is LessThanOrEqual {
  return isRecord(value) && Number.isSafeInteger(value.$lte)
}

class FakeQuery implements CloudBaseQueryReference {
  #direction: 'asc' | 'desc' = 'asc'
  #field = '_id'
  #limit = 100

  constructor(
    private readonly source: () => Record<string, unknown>[],
    private readonly condition: Record<string, unknown>,
  ) {}

  orderBy(field: string, direction: 'asc' | 'desc'): CloudBaseQueryReference {
    this.#field = field
    this.#direction = direction
    return this
  }

  limit(limit: number): CloudBaseQueryReference {
    this.#limit = limit
    return this
  }

  async get(): Promise<CloudBaseGetResult> {
    const matches = this.source().filter(record => Object.entries(this.condition).every(([key, expected]) => {
      const actual = record[key]
      if (isLessThanOrEqual(expected))
        return typeof actual === 'number' && actual <= expected.$lte
      return actual === expected
    }))
    matches.sort((left, right) => {
      const a = left[this.#field]
      const b = right[this.#field]
      const comparison = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b))
      return this.#direction === 'asc' ? comparison : -comparison
    })
    return { data: structuredClone(matches.slice(0, this.#limit)) }
  }
}

class FakeDatabase implements CloudBaseDatabase {
  readonly documents = new Map<string, Map<string, Record<string, unknown>>>()
  readonly writes: Record<string, unknown>[] = []
  failNextUpdate = false
  readonly command = {
    lte: (value: number): LessThanOrEqual => ({ $lte: value }),
  }

  #queue = Promise.resolve()

  collection(name: string): CloudBaseCollectionReference {
    const records = this.#records(name)
    return {
      doc: (id: string): CloudBaseDocumentReference => ({
        get: async () => {
          const record = records.get(id)
          return { data: record ? [structuredClone(record)] : [] }
        },
        set: async (data) => {
          this.writes.push(structuredClone(data))
          records.set(id, { ...structuredClone(data), _id: id })
          return { updated: 1 }
        },
        update: async (data) => {
          this.writes.push(structuredClone(data))
          if (this.failNextUpdate) {
            this.failNextUpdate = false
            return { updated: 0 }
          }
          const current = records.get(id)
          if (!current)
            throw new Error(`missing document: ${id}`)
          records.set(id, { ...current, ...structuredClone(data), _id: id })
          return { updated: 1 }
        },
        remove: async () => {
          records.delete(id)
          return { removed: 1 }
        },
      }),
      where: condition => new FakeQuery(() => [...records.values()].map(value => structuredClone(value)), condition),
    }
  }

  async runTransaction<T>(operation: (transaction: CloudBaseTransaction) => Promise<T>): Promise<T> {
    const previous = this.#queue
    let release: () => void = () => undefined
    this.#queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation({ collection: name => this.collection(name) })
    }
    finally {
      release()
    }
  }

  #records(name: string): Map<string, Record<string, unknown>> {
    const existing = this.documents.get(name)
    if (existing)
      return existing
    const created = new Map<string, Record<string, unknown>>()
    this.documents.set(name, created)
    return created
  }
}

function tokenBytes(value: number): Uint8Array {
  return new Uint8Array(32).fill(value)
}

function fixture(maxSessions = 5) {
  let now = 1_000
  let byte = 1
  const database = new FakeDatabase()
  const store = new CloudBaseSessionStore({ database })
  const service = new ServerSessionService({
    store,
    policy: {
      idleTtlMs: 1_000,
      absoluteTtlMs: 5_000,
      touchIntervalMs: 100,
      rotationIntervalMs: 500,
      maxSessions,
    },
    clock: { now: () => now },
    tokenSource: { randomBytes: () => tokenBytes(byte++) },
  })
  return {
    database,
    service,
    store,
    sweeper: new CloudBaseSessionSweeper({ database }),
    advance: (milliseconds: number) => now += milliseconds,
    now: () => now,
  }
}

describe('cloudBaseSessionStore', () => {
  it('transactionally enforces the active-session cap under concurrent creation', async () => {
    const { database, service, store } = fixture(2)
    const issued = await Promise.all([
      service.create({ appId: 'drive', userId: 'u1', deviceLabel: 'one' }),
      service.create({ appId: 'drive', userId: 'u1', deviceLabel: 'two' }),
      service.create({ appId: 'drive', userId: 'u1', deviceLabel: 'three' }),
    ])

    expect(await store.listForUser({ appId: 'drive', userId: 'u1' })).toHaveLength(2)
    const results = await Promise.all(issued.map(session => service.validate(session.token)))
    expect(results.filter(result => result.ok)).toHaveLength(2)
    expect(results.filter(result => !result.ok && result.reason === 'revoked')).toHaveLength(1)

    for (const write of database.writes) {
      expect(write).not.toHaveProperty('_id')
      expect(write).not.toHaveProperty('token')
      expect(write).not.toHaveProperty('accessToken')
      expect(write).not.toHaveProperty('refreshToken')
      expect(write).not.toHaveProperty('csrfSecret')
      expect(write).not.toHaveProperty('cosCredential')
      for (const session of issued)
        expect(Object.values(write)).not.toContain(session.token)
    }
  })

  it('atomically rotates and revokes tokens without allowing replay', async () => {
    const { service, advance } = fixture()
    const issued = await service.create({ appId: 'drive', userId: 'u1' })
    advance(500)
    const rotated = await service.rotate(issued.token)
    expect('token' in rotated).toBe(true)
    if (!('token' in rotated))
      throw new Error('expected rotation')
    expect(await service.validate(issued.token)).toEqual({ ok: false, reason: 'revoked' })
    expect((await service.validate(rotated.token)).ok).toBe(true)
    expect(await service.revoke(rotated.token)).toBe(true)
    expect(await service.validate(rotated.token)).toEqual({ ok: false, reason: 'revoked' })
  })

  it('sweeps idle-expired records through indexed discovery and optimistic expiry', async () => {
    const { service, store, sweeper, advance, now } = fixture()
    const issued = await service.create({ appId: 'drive', userId: 'u1' })
    advance(1_000)
    expect(await sweeper.sweepExpired({ now: now(), limit: 10 })).toEqual({ scanned: 1, expired: 1 })
    expect(await service.validate(issued.token)).toEqual({ ok: false, reason: 'expired' })
    expect(await store.listForUser({ appId: 'drive', userId: 'u1' })).toEqual([])
  })

  it('maps a zero-document SDK update to a stable optimistic conflict', async () => {
    const { database, service } = fixture()
    const issued = await service.create({ appId: 'drive', userId: 'u1' })
    database.failNextUpdate = true
    await expect(service.revoke(issued.token)).rejects.toMatchObject({ code: 'SESSION_CONFLICT' })
  })

  it('revokes all app sessions for a security event and cleans retained terminal records', async () => {
    const { service, sweeper, now } = fixture()
    const first = await service.create({ appId: 'drive', userId: 'u1' })
    const second = await service.create({ appId: 'drive', userId: 'u1' })
    expect(await service.revokeAllForUser({ appId: 'drive', userId: 'u1' })).toBe(2)
    expect(await service.validate(first.token)).toEqual({ ok: false, reason: 'revoked' })
    expect(await service.validate(second.token)).toEqual({ ok: false, reason: 'revoked' })
    expect(await sweeper.sweepTerminal({ now: now() + 86_400_000, retentionMs: 86_400_000, limit: 10 })).toEqual({ scanned: 2, removed: 2 })
  })

  it('conservatively removes retained schema-v1 terminal records without terminatedAt', async () => {
    const { database, sweeper } = fixture()
    const id = 'e'.repeat(64)
    database.documents.set('ylf_app_sessions', new Map([[id, {
      _id: id,
      recordType: 'session',
      schemaVersion: 1,
      appId: 'drive',
      userId: 'u1',
      status: 'revoked',
      createdAt: 100,
      rotatedAt: 100,
      lastSeenAt: 100,
      idleExpiresAt: 200,
      absoluteExpiresAt: 300,
      revokedAt: 150,
      version: 2,
    }]]))

    await expect(sweeper.sweepTerminal({ now: 86_400_301, retentionMs: 86_400_000, limit: 10 }))
      .resolves
      .toEqual({ scanned: 1, removed: 1 })
    expect(database.documents.get('ylf_app_sessions')?.has(id)).toBe(false)
  })

  it('does not let the legacy fallback purge a recently terminated schema-v2 session', async () => {
    const { database, sweeper } = fixture()
    const id = 'f'.repeat(64)
    database.documents.set('ylf_app_sessions', new Map([[id, {
      _id: id,
      recordType: 'session',
      schemaVersion: 2,
      appId: 'drive',
      userId: 'u1',
      status: 'revoked',
      createdAt: 100,
      rotatedAt: 100,
      lastSeenAt: 100,
      idleExpiresAt: 200,
      absoluteExpiresAt: 300,
      revokedAt: 86_400_250,
      terminatedAt: 86_400_250,
      version: 2,
    }]]))

    await expect(sweeper.sweepTerminal({ now: 86_400_301, retentionMs: 86_400_000, limit: 10 }))
      .resolves
      .toEqual({ scanned: 0, removed: 0 })
    expect(database.documents.get('ylf_app_sessions')?.has(id)).toBe(true)
  })

  it('exports the exact server-only collection and index manifest', () => {
    expect(CLOUD_BASE_SESSION_COLLECTION_MANIFEST).toEqual({
      collection: 'ylf_app_sessions',
      access: 'server-only',
      browserRead: false,
      browserWrite: false,
      indexes: [
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
        {
          name: 'status_terminated',
          unique: false,
          fields: [
            { field: 'status', order: 'asc' },
            { field: 'terminatedAt', order: 'asc' },
          ],
          purpose: 'bounded retention cleanup for revoked and expired sessions',
        },
      ],
      retention: { terminalRecordDays: 90 },
    })
  })
})
