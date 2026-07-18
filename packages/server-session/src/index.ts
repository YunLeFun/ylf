import { Buffer } from 'node:buffer'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Stable errors exposed by the reusable session layer. */
export type SessionErrorCode
  = | 'INVALID_INPUT'
    | 'SESSION_NOT_FOUND'
    | 'SESSION_EXPIRED'
    | 'SESSION_REVOKED'
    | 'SESSION_CONFLICT'
    | 'FORBIDDEN'
    | 'STORE_ERROR'

/** Error with a stable, transport-independent code. */
export class SessionError extends Error {
  readonly code: SessionErrorCode

  constructor(code: SessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SessionError'
    this.code = code
  }
}

/** Persisted lifecycle state. */
export type SessionStatus = 'active' | 'revoked' | 'expired'

/** Persisted session metadata. Raw tokens and CSRF material must never be added here. */
export interface AppSession {
  /** SHA-256 digest of the opaque token, encoded as lowercase hexadecimal. */
  id: string
  /** Application boundary, for example `drive` or `cms`. */
  appId: string
  /** Stable authenticated user identifier. */
  userId: string
  /** Current lifecycle state. */
  status: SessionStatus
  /** Session-family creation time in epoch milliseconds. */
  createdAt: number
  /** Last token rotation time in epoch milliseconds. */
  rotatedAt: number
  /** Last accepted activity time in epoch milliseconds. */
  lastSeenAt: number
  /** Rolling idle deadline in epoch milliseconds. */
  idleExpiresAt: number
  /** Non-extendable session-family deadline in epoch milliseconds. */
  absoluteExpiresAt: number
  /** Revocation time when status is `revoked`. */
  revokedAt?: number
  /** Optional user-facing device label. */
  deviceLabel?: string
  /** Optional privacy-preserving user-agent digest. */
  userAgentHash?: string
  /** Optional privacy-preserving network-prefix digest. */
  ipPrefixHash?: string
  /** Optimistic concurrency version. */
  version: number
}

/** Runtime policy for one application. All durations use milliseconds. */
export interface SessionPolicy {
  /** Rolling inactivity lifetime. */
  idleTtlMs: number
  /** Maximum lifetime of a session family. */
  absoluteTtlMs: number
  /** Minimum interval between persisted activity updates. */
  touchIntervalMs: number
  /** Age after which callers should rotate the opaque token. */
  rotationIntervalMs: number
  /** Maximum concurrently active sessions per app and user. */
  maxSessions: number
}

/** Metadata accepted when creating a new session. */
export interface CreateSessionInput {
  appId: string
  userId: string
  deviceLabel?: string
  userAgentHash?: string
  ipPrefixHash?: string
}

/** Newly issued raw token and its safe persisted metadata. */
export interface IssuedSession {
  token: string
  session: AppSession
  revokedSessionIds: string[]
}

/** Successful validation result. */
export interface ActiveSessionResult {
  ok: true
  session: AppSession
  shouldRotate: boolean
}

/** Failed validation result. */
export interface InactiveSessionResult {
  ok: false
  reason: 'invalid' | 'expired' | 'revoked'
}

/** Result of validating an opaque token. */
export type SessionValidationResult = ActiveSessionResult | InactiveSessionResult

/** Atomic creation request passed to a store. */
export interface CreateStoredSessionInput {
  session: AppSession
  maxSessions: number
}

/** Atomic creation result returned by a store. */
export interface CreateStoredSessionResult {
  session: AppSession
  revokedSessionIds: string[]
}

/** Optimistic rolling-expiry update. */
export interface TouchStoredSessionInput {
  sessionId: string
  expectedVersion: number
  lastSeenAt: number
  idleExpiresAt: number
}

/** Atomic token rotation request. */
export interface RotateStoredSessionInput {
  currentSessionId: string
  expectedVersion: number
  nextSession: AppSession
  maxSessions: number
  rotatedAt: number
}

/** Atomic token rotation result. */
export interface RotateStoredSessionResult extends CreateStoredSessionResult {}

/** Atomic expiry request guarded against stale readers. */
export interface ExpireStoredSessionInput {
  sessionId: string
  expectedVersion: number
  expiredAt: number
}

/** Filter used by device/session administration. */
export interface UserSessionFilter {
  appId: string
  userId: string
}

/** Framework- and database-neutral persistence port. Mutating methods must be atomic. */
export interface SessionStore {
  /** Create a session and enforce the concurrent-session cap in one transaction. */
  createAndEnforceLimit: (input: CreateStoredSessionInput) => Promise<CreateStoredSessionResult>
  /** Read a session by its SHA-256 identifier. */
  findById: (sessionId: string) => Promise<AppSession | null>
  /** Extend rolling activity only if the optimistic version still matches. */
  touch: (input: TouchStoredSessionInput) => Promise<AppSession | null>
  /** Atomically revoke the current token, create its replacement, and enforce the cap. */
  rotate: (input: RotateStoredSessionInput) => Promise<RotateStoredSessionResult | null>
  /** Mark a due session expired if the optimistic version still matches. */
  expire: (input: ExpireStoredSessionInput) => Promise<boolean>
  /** Revoke one session. Repeated calls are idempotent. */
  revoke: (sessionId: string, revokedAt: number) => Promise<boolean>
  /** Revoke all other active sessions for the same application and user. */
  revokeOthers: (filter: UserSessionFilter, currentSessionId: string, revokedAt: number) => Promise<number>
  /** List safe session metadata for device management. */
  listForUser: (filter: UserSessionFilter) => Promise<AppSession[]>
}

/** Clock seam used by deterministic tests and serverless runtimes. */
export interface SessionClock {
  /** Current epoch time in milliseconds. */
  now: () => number
}

/** Entropy seam. Implementations must return exactly 32 cryptographically random bytes. */
export interface SessionTokenSource {
  /** Return 256 bits of entropy. */
  randomBytes: () => Uint8Array
}

/** Dependencies required by {@link ServerSessionService}. */
export interface ServerSessionDependencies {
  store: SessionStore
  policy: SessionPolicy
  clock?: SessionClock
  tokenSource?: SessionTokenSource
}

const OPAQUE_TOKEN_PATTERN = /^[\w-]{43}$/
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new SessionError('INVALID_INPUT', `${name} must be a positive safe integer`)
}

function validatePolicy(policy: SessionPolicy): void {
  assertPositiveInteger('idleTtlMs', policy.idleTtlMs)
  assertPositiveInteger('absoluteTtlMs', policy.absoluteTtlMs)
  assertPositiveInteger('touchIntervalMs', policy.touchIntervalMs)
  assertPositiveInteger('rotationIntervalMs', policy.rotationIntervalMs)
  assertPositiveInteger('maxSessions', policy.maxSessions)
  if (policy.idleTtlMs > policy.absoluteTtlMs)
    throw new SessionError('INVALID_INPUT', 'idleTtlMs cannot exceed absoluteTtlMs')
  if (policy.touchIntervalMs > policy.idleTtlMs)
    throw new SessionError('INVALID_INPUT', 'touchIntervalMs cannot exceed idleTtlMs')
  if (policy.maxSessions > 100)
    throw new SessionError('INVALID_INPUT', 'maxSessions cannot exceed 100')
}

function assertIdentityPart(name: string, value: string): void {
  if (!value.trim() || value.length > 128)
    throw new SessionError('INVALID_INPUT', `${name} must contain 1 to 128 characters`)
}

/** Create a URL-safe opaque token containing exactly 256 bits of entropy. */
export function createOpaqueToken(bytes: Uint8Array = randomBytes(32)): string {
  if (bytes.byteLength !== 32)
    throw new SessionError('INVALID_INPUT', 'session entropy must be exactly 32 bytes')
  return Buffer.from(bytes).toString('base64url')
}

/** Hash a valid opaque token for persistence and lookup. */
export function hashOpaqueToken(token: string): string {
  if (!OPAQUE_TOKEN_PATTERN.test(token))
    throw new SessionError('INVALID_INPUT', 'invalid opaque session token')
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Compare a raw opaque token to its expected identifier without data-dependent comparison. */
export function verifyOpaqueToken(token: string, expectedId: string): boolean {
  if (!OPAQUE_TOKEN_PATTERN.test(token) || !SHA256_HEX_PATTERN.test(expectedId))
    return false
  const actual = Buffer.from(createHash('sha256').update(token, 'utf8').digest('hex'), 'hex')
  const expected = Buffer.from(expectedId, 'hex')
  return timingSafeEqual(actual, expected)
}

/** Derive a stateless, session-bound CSRF value using a separate platform secret. */
export function deriveSessionCsrfToken(
  sessionToken: string,
  platformSecret: string | Uint8Array,
  scope = 'session',
): string {
  if (!OPAQUE_TOKEN_PATTERN.test(sessionToken))
    throw new SessionError('INVALID_INPUT', 'invalid opaque session token')
  const secret = typeof platformSecret === 'string' ? Buffer.from(platformSecret, 'utf8') : Buffer.from(platformSecret)
  if (secret.byteLength < 32)
    throw new SessionError('INVALID_INPUT', 'CSRF platform secret must contain at least 32 bytes')
  if (!scope || scope.length > 128)
    throw new SessionError('INVALID_INPUT', 'invalid CSRF scope')
  const digest = createHmac('sha256', secret)
    .update('ylf-csrf-v1\0', 'utf8')
    .update(scope, 'utf8')
    .update('\0', 'utf8')
    .update(sessionToken, 'utf8')
    .digest('base64url')
  return `v1.${digest}`
}

/** Verify a CSRF value with constant-time comparison. */
export function verifySessionCsrfToken(
  csrfToken: string,
  sessionToken: string,
  platformSecret: string | Uint8Array,
  scope = 'session',
): boolean {
  if (!/^v1\.[\w-]{43}$/.test(csrfToken))
    return false
  let expected: string
  try {
    expected = deriveSessionCsrfToken(sessionToken, platformSecret, scope)
  }
  catch {
    return false
  }
  return timingSafeEqual(Buffer.from(csrfToken, 'utf8'), Buffer.from(expected, 'utf8'))
}

/** High-level application-session service. It never persists raw bearer material. */
export class ServerSessionService {
  readonly #store: SessionStore
  readonly #policy: SessionPolicy
  readonly #clock: SessionClock
  readonly #tokenSource: SessionTokenSource

  constructor(dependencies: ServerSessionDependencies) {
    validatePolicy(dependencies.policy)
    this.#store = dependencies.store
    this.#policy = { ...dependencies.policy }
    this.#clock = dependencies.clock ?? { now: () => Date.now() }
    this.#tokenSource = dependencies.tokenSource ?? { randomBytes: () => randomBytes(32) }
  }

  /** Create a new session and transactionally enforce the per-user device cap. */
  async create(input: CreateSessionInput): Promise<IssuedSession> {
    assertIdentityPart('appId', input.appId)
    assertIdentityPart('userId', input.userId)
    const now = this.#clock.now()
    const token = this.#nextToken()
    const session: AppSession = {
      id: hashOpaqueToken(token),
      appId: input.appId,
      userId: input.userId,
      status: 'active',
      createdAt: now,
      rotatedAt: now,
      lastSeenAt: now,
      idleExpiresAt: Math.min(now + this.#policy.idleTtlMs, now + this.#policy.absoluteTtlMs),
      absoluteExpiresAt: now + this.#policy.absoluteTtlMs,
      ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
      ...(input.userAgentHash ? { userAgentHash: input.userAgentHash } : {}),
      ...(input.ipPrefixHash ? { ipPrefixHash: input.ipPrefixHash } : {}),
      version: 1,
    }
    const stored = await this.#store.createAndEnforceLimit({
      session,
      maxSessions: this.#policy.maxSessions,
    })
    return { token, ...stored }
  }

  /** Validate status and deadlines, and roll idle activity at a bounded frequency. */
  async validate(token: string): Promise<SessionValidationResult> {
    let sessionId: string
    try {
      sessionId = hashOpaqueToken(token)
    }
    catch {
      return { ok: false, reason: 'invalid' }
    }
    const session = await this.#store.findById(sessionId)
    if (!session || !verifyOpaqueToken(token, session.id))
      return { ok: false, reason: 'invalid' }
    if (session.status === 'revoked')
      return { ok: false, reason: 'revoked' }
    if (session.status === 'expired')
      return { ok: false, reason: 'expired' }

    const now = this.#clock.now()
    if (now >= session.idleExpiresAt || now >= session.absoluteExpiresAt) {
      await this.#store.expire({ sessionId, expectedVersion: session.version, expiredAt: now })
      return { ok: false, reason: 'expired' }
    }

    let current = session
    if (now - session.lastSeenAt >= this.#policy.touchIntervalMs) {
      current = await this.#store.touch({
        sessionId,
        expectedVersion: session.version,
        lastSeenAt: now,
        idleExpiresAt: Math.min(now + this.#policy.idleTtlMs, session.absoluteExpiresAt),
      }) ?? session
    }

    return {
      ok: true,
      session: current,
      shouldRotate: now - current.rotatedAt >= this.#policy.rotationIntervalMs,
    }
  }

  /** Rotate a valid token. The old token becomes unusable in the same store transaction. */
  async rotate(token: string): Promise<IssuedSession | InactiveSessionResult> {
    const validation = await this.validate(token)
    if (!validation.ok)
      return validation

    const current = validation.session
    const now = this.#clock.now()
    const nextToken = this.#nextToken()
    const nextSession: AppSession = {
      ...current,
      id: hashOpaqueToken(nextToken),
      status: 'active',
      rotatedAt: now,
      lastSeenAt: now,
      idleExpiresAt: Math.min(now + this.#policy.idleTtlMs, current.absoluteExpiresAt),
      version: current.version + 1,
    }
    delete nextSession.revokedAt

    const stored = await this.#store.rotate({
      currentSessionId: current.id,
      expectedVersion: current.version,
      nextSession,
      maxSessions: this.#policy.maxSessions,
      rotatedAt: now,
    })
    if (!stored)
      throw new SessionError('SESSION_CONFLICT', 'session changed while rotating')
    return { token: nextToken, ...stored }
  }

  /** Revoke the session represented by an opaque token. */
  async revoke(token: string): Promise<boolean> {
    let sessionId: string
    try {
      sessionId = hashOpaqueToken(token)
    }
    catch {
      return false
    }
    return this.#store.revoke(sessionId, this.#clock.now())
  }

  /** Revoke every other active session for the same app and user. */
  async revokeOthers(token: string): Promise<number> {
    const validation = await this.validate(token)
    if (!validation.ok) {
      throw new SessionError(
        validation.reason === 'expired' ? 'SESSION_EXPIRED' : validation.reason === 'revoked' ? 'SESSION_REVOKED' : 'SESSION_NOT_FOUND',
        'an active current session is required',
      )
    }
    return this.#store.revokeOthers(
      { appId: validation.session.appId, userId: validation.session.userId },
      validation.session.id,
      this.#clock.now(),
    )
  }

  /** List a user's session/device metadata without exposing bearer material. */
  listForUser(filter: UserSessionFilter): Promise<AppSession[]> {
    assertIdentityPart('appId', filter.appId)
    assertIdentityPart('userId', filter.userId)
    return this.#store.listForUser(filter)
  }

  #nextToken(): string {
    return createOpaqueToken(this.#tokenSource.randomBytes())
  }
}
