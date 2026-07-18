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
} from '../src'
import { describe, expect, it } from 'vitest'
import {
  createOpaqueToken,
  deriveSessionCsrfToken,
  hashOpaqueToken,
  ServerSessionService,
  verifyOpaqueToken,
  verifySessionCsrfToken,
} from '../src'

class MemorySessionStore implements SessionStore {
  readonly records = new Map<string, AppSession>()
  #queue = Promise.resolve()

  async #atomic<T>(operation: () => T): Promise<T> {
    const previous = this.#queue
    let release: () => void = () => undefined
    this.#queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return operation()
    }
    finally {
      release()
    }
  }

  async createAndEnforceLimit(input: CreateStoredSessionInput): Promise<CreateStoredSessionResult> {
    return this.#atomic(() => {
      if (this.records.has(input.session.id))
        throw new Error('duplicate session id')
      this.records.set(input.session.id, structuredClone(input.session))
      const revokedSessionIds = this.#enforce(input.session.appId, input.session.userId, input.maxSessions, input.session.createdAt)
      return { session: structuredClone(input.session), revokedSessionIds }
    })
  }

  async findById(sessionId: string): Promise<AppSession | null> {
    const session = this.records.get(sessionId)
    return session ? structuredClone(session) : null
  }

  async touch(input: TouchStoredSessionInput): Promise<AppSession | null> {
    return this.#atomic(() => {
      const current = this.records.get(input.sessionId)
      if (!current || current.status !== 'active' || current.version !== input.expectedVersion)
        return null
      const next = { ...current, lastSeenAt: input.lastSeenAt, idleExpiresAt: input.idleExpiresAt, version: current.version + 1 }
      this.records.set(next.id, next)
      return structuredClone(next)
    })
  }

  async rotate(input: RotateStoredSessionInput): Promise<RotateStoredSessionResult | null> {
    return this.#atomic(() => {
      const current = this.records.get(input.currentSessionId)
      if (!current || current.status !== 'active' || current.version !== input.expectedVersion || this.records.has(input.nextSession.id))
        return null
      this.records.set(current.id, { ...current, status: 'revoked', revokedAt: input.rotatedAt, version: current.version + 1 })
      this.records.set(input.nextSession.id, structuredClone(input.nextSession))
      const revokedSessionIds = [current.id, ...this.#enforce(
        input.nextSession.appId,
        input.nextSession.userId,
        input.maxSessions,
        input.rotatedAt,
      )]
      return { session: structuredClone(input.nextSession), revokedSessionIds: [...new Set(revokedSessionIds)] }
    })
  }

  async expire(input: ExpireStoredSessionInput): Promise<boolean> {
    return this.#atomic(() => {
      const current = this.records.get(input.sessionId)
      if (!current || current.status !== 'active' || current.version !== input.expectedVersion)
        return false
      this.records.set(current.id, { ...current, status: 'expired', version: current.version + 1 })
      return true
    })
  }

  async revoke(sessionId: string, revokedAt: number): Promise<boolean> {
    return this.#atomic(() => {
      const current = this.records.get(sessionId)
      if (!current)
        return false
      if (current.status !== 'active')
        return true
      this.records.set(current.id, { ...current, status: 'revoked', revokedAt, version: current.version + 1 })
      return true
    })
  }

  async revokeOthers(filter: UserSessionFilter, currentSessionId: string, revokedAt: number): Promise<number> {
    return this.#atomic(() => {
      let count = 0
      for (const current of this.records.values()) {
        if (current.id !== currentSessionId && current.appId === filter.appId && current.userId === filter.userId && current.status === 'active') {
          this.records.set(current.id, { ...current, status: 'revoked', revokedAt, version: current.version + 1 })
          count++
        }
      }
      return count
    })
  }

  async listForUser(filter: UserSessionFilter): Promise<AppSession[]> {
    return [...this.records.values()]
      .filter(session => session.appId === filter.appId && session.userId === filter.userId)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt || left.id.localeCompare(right.id))
      .map(session => structuredClone(session))
  }

  #enforce(appId: string, userId: string, limit: number, revokedAt: number): string[] {
    const active = [...this.records.values()]
      .filter(session => session.appId === appId && session.userId === userId && session.status === 'active')
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    const evicted = active.slice(0, Math.max(0, active.length - limit))
    for (const current of evicted)
      this.records.set(current.id, { ...current, status: 'revoked', revokedAt, version: current.version + 1 })
    return evicted.map(session => session.id)
  }
}

function tokenBytes(value: number): Uint8Array {
  return new Uint8Array(32).fill(value)
}

function fixture(maxSessions = 5) {
  let now = 1_000
  let byte = 1
  const store = new MemorySessionStore()
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
  return { service, store, advance: (ms: number) => now += ms }
}

describe('opaque primitives', () => {
  it('issues exactly 256-bit URL-safe tokens and hashes them deterministically', () => {
    const token = createOpaqueToken(tokenBytes(7))
    expect(token).toMatch(/^[\w-]{43}$/)
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/)
    expect(verifyOpaqueToken(token, hashOpaqueToken(token))).toBe(true)
    expect(verifyOpaqueToken(createOpaqueToken(tokenBytes(8)), hashOpaqueToken(token))).toBe(false)
  })

  it('derives a session-bound CSRF value with a separate secret', () => {
    const token = createOpaqueToken(tokenBytes(7))
    const secret = 's'.repeat(32)
    const csrf = deriveSessionCsrfToken(token, secret, 'drive')
    expect(verifySessionCsrfToken(csrf, token, secret, 'drive')).toBe(true)
    expect(verifySessionCsrfToken(csrf, createOpaqueToken(tokenBytes(8)), secret, 'drive')).toBe(false)
    expect(verifySessionCsrfToken(csrf, token, 'x'.repeat(32), 'drive')).toBe(false)
  })
})

describe('serverSessionService', () => {
  it('enforces idle and absolute expiry and rolls activity only at the configured interval', async () => {
    const { service, store, advance } = fixture()
    const issued = await service.create({ appId: 'drive', userId: 'u1' })
    advance(99)
    expect((await service.validate(issued.token)).ok).toBe(true)
    expect((await store.findById(issued.session.id))?.version).toBe(1)
    advance(1)
    const touched = await service.validate(issued.token)
    expect(touched.ok && touched.session.version).toBe(2)
    advance(1_000)
    expect(await service.validate(issued.token)).toEqual({ ok: false, reason: 'expired' })
  })

  it('atomically evicts the oldest sessions under concurrent creation', async () => {
    const { service, store } = fixture(2)
    const sessions = await Promise.all([
      service.create({ appId: 'drive', userId: 'u1' }),
      service.create({ appId: 'drive', userId: 'u1' }),
      service.create({ appId: 'drive', userId: 'u1' }),
    ])
    const active = [...store.records.values()].filter(session => session.status === 'active')
    expect(active).toHaveLength(2)
    expect(await service.validate(sessions[0].token)).toEqual({ ok: false, reason: 'revoked' })
  })

  it('rotates atomically so an old token cannot be replayed', async () => {
    const { service, advance } = fixture()
    const issued = await service.create({ appId: 'drive', userId: 'u1' })
    advance(500)
    const validation = await service.validate(issued.token)
    expect(validation.ok && validation.shouldRotate).toBe(true)
    const rotated = await service.rotate(issued.token)
    expect('token' in rotated).toBe(true)
    if (!('token' in rotated))
      throw new Error('expected rotation')
    expect(await service.validate(issued.token)).toEqual({ ok: false, reason: 'revoked' })
    expect((await service.validate(rotated.token)).ok).toBe(true)
  })

  it('revokes one session or every other session idempotently', async () => {
    const { service } = fixture()
    const first = await service.create({ appId: 'drive', userId: 'u1' })
    const second = await service.create({ appId: 'drive', userId: 'u1' })
    const third = await service.create({ appId: 'drive', userId: 'u1' })
    expect(await service.revokeOthers(second.token)).toBe(2)
    expect(await service.revokeOthers(second.token)).toBe(0)
    expect(await service.validate(first.token)).toEqual({ ok: false, reason: 'revoked' })
    expect(await service.validate(third.token)).toEqual({ ok: false, reason: 'revoked' })
    expect(await service.revoke(second.token)).toBe(true)
    expect(await service.revoke(second.token)).toBe(true)
  })
})
