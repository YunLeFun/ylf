import type { KeyObject } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { createSupportClient, SupportClientError } from './feedback'

export { SupportClientError as SupportApiError } from './feedback'

/** Server-only credentials and a trusted account or server-derived anonymous identity. */
export type SupportServerClientOptions = {
  readonly clientId: string
  readonly keyId: string
  readonly privateKey: string | KeyObject
  readonly baseUrl?: string
  readonly fetch?: typeof globalThis.fetch
} & ({ readonly userId: string, readonly guestId?: never } | { readonly guestId: string, readonly userId?: never })

/** Sign requests on the application server; anonymous identities require allowGuests registration. */
export function createSupportServerClient(options: SupportServerClientOptions) {
  const subject = options.guestId ?? options.userId
  if (!subject || !/^[A-Z0-9][\w-]{0,127}$/i.test(subject) || (options.guestId !== undefined && options.userId !== undefined))
    throw new TypeError('Provide one canonical account or guest identity')
  const key = typeof options.privateKey === 'string' ? createPrivateKey(options.privateKey) : options.privateKey
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new TypeError('Support integration requires an ES256 private key')
  return createSupportClient({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    createAssertion: async (request) => {
      const now = Math.floor(Date.now() / 1000)
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const header = encode({ alg: 'ES256', typ: 'support-integration+jwt', kid: options.keyId })
      const payload = encode({
        iss: options.clientId,
        sub: subject,
        ...(options.guestId ? { requesterKind: 'guest' } : {}),
        aud: 'support-private-api',
        iat: now,
        exp: now + 60,
        jti: randomUUID(),
        scope: 'feedback:submit',
        method: request.method,
        path: request.path,
        idempotencyKey: request.idempotencyKey,
        bodyHash: createHash('sha256').update(request.body).digest('hex'),
      })
      const content = `${header}.${payload}`
      return `${content}.${sign('sha256', Buffer.from(content), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
    },
  })
}

/** Scoped operations client for trusted AI/operator processes; never bundle this entry for browsers. */
export function createSupportAgentClient(options: Omit<SupportServerClientOptions, 'guestId' | 'userId'> & { readonly userId: string }) {
  const origin = new URL(options.baseUrl ?? 'https://support.yunle.fun')
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new TypeError('Support baseUrl must be an exact HTTPS origin')
  const key = typeof options.privateKey === 'string' ? createPrivateKey(options.privateKey) : options.privateKey
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new TypeError('Support agent requires ES256 credentials')
  const request = async (path: string, scope: string, data: unknown, idempotencyKey: string): Promise<unknown> => {
    if (!/^[\w-]{8,128}$/.test(idempotencyKey))
      throw new TypeError('Stable operation key required')
    const now = Math.floor(Date.now() / 1000)
    const body = JSON.stringify(data)
    const encode = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const unsigned = `${encode({ alg: 'ES256', typ: 'support-integration+jwt', kid: options.keyId })}.${encode({
      iss: options.clientId,
      sub: options.userId,
      aud: 'support-private-api',
      iat: now,
      exp: now + 60,
      jti: randomUUID(),
      scope,
      path,
      method: 'POST',
      idempotencyKey,
      bodyHash: createHash('sha256').update(body).digest('hex'),
    })}`
    const token = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
    const response = await (options.fetch ?? globalThis.fetch)(new URL(path, origin), {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'idempotency-key': idempotencyKey },
    })
    const result: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error = result && typeof result === 'object' ? result as Record<string, unknown> : {}
      throw new SupportClientError(typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR', response.status)
    }
    return result
  }
  return {
    /** Query one product; callers must follow nextCursor until absent. */
    query: (input: { productId: string, id?: string, cursor?: string }) => request('/api/integrations/v1/tickets/query', 'tickets:read', input, randomUUID()),
    /** Retry the exact input with the same key after unknown outcomes. */
    command: (input: { id: string, version: number, command: { action: string, [key: string]: unknown } }, key: string) =>
      request('/api/integrations/v1/tickets/commands', input.command.action === 'reply.send' ? 'tickets:reply' : 'tickets:write', input, key),
    /** Convert one existing private submission with live product authorization. */
    convert: (id: string) => request('/api/integrations/v1/tickets/commands', 'tickets:write', { id, convert: true }, randomUUID()),
    /** Drain a bounded notification batch; unknown provider outcomes are never resent. */
    dispatch: (input: { productId: string, id?: string }) => request('/api/integrations/v1/tickets/dispatch', 'tickets:reply', input, randomUUID()),
  }
}
