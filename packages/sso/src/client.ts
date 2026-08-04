import type { SsoPrompt, SsoRedirectResult } from './protocol'
import {
  buildSsoRequestUrl,
  deriveSsoPkceChallenge,
  hasSsoRedirectResult,
  isSsoPkceVerifier,
  parseSsoRedirectResult,
  readSsoClientId,
  readSsoRedirectUri,
  readSsoScope,
} from './protocol'

export const YLF_DEFAULT_SSO_ORIGIN = 'https://www.yunle.fun'
export const YLF_DEFAULT_SSO_EXCHANGE_URL = 'https://api.yunle.fun/sso-ticket'

const TRANSACTION_KEY = 'ylf:sso:v3:transaction'
const TRANSACTION_TTL_MS = 10 * 60 * 1000

export interface RedirectSsoOptions {
  clientId: string
  scope: readonly string[]
  redirectUri: string
  ssoOrigin?: string
  /** Provider interaction hint. It is never stored in or returned from the authorization transaction. */
  prompt?: SsoPrompt
}

export interface SsoAuthorizationResult {
  ok: true
  code: string
  issuer: string
  clientId: string
  scope: readonly string[]
  redirectUri: string
  nonce: string
  codeVerifier: string
}

export interface SsoAdoptionAuth {
  signInWithCustomTicket: (getTicket: () => Promise<string>) => Promise<unknown>
}

export type SsoFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface SsoCodeExchangeOptions {
  exchangeUrl?: string
  fetch?: SsoFetch
}

interface StoredTransaction {
  issuer: string
  clientId: string
  scope: string[]
  redirectUri: string
  nonce: string
  codeVerifier: string
  createdAt: number
}

export async function startSsoRedirect(options: RedirectSsoOptions): Promise<void> {
  if (typeof window === 'undefined')
    return

  const issuer = new URL(options.ssoOrigin ?? YLF_DEFAULT_SSO_ORIGIN).origin
  const nonce = randomBase64Url(32)
  const codeVerifier = randomBase64Url(32)
  const codeChallenge = await deriveSsoPkceChallenge(codeVerifier)
  const authorizationUrl = buildSsoRequestUrl({
    ssoOrigin: issuer,
    clientId: options.clientId,
    scope: options.scope,
    redirectUri: options.redirectUri,
    nonce,
    codeChallenge,
    prompt: options.prompt,
  })

  if (new URL(options.redirectUri).origin !== window.location.origin)
    throw new TypeError('SSO redirect URI must belong to the current origin')

  const transaction: StoredTransaction = {
    issuer,
    clientId: options.clientId,
    scope: [...options.scope],
    redirectUri: options.redirectUri,
    nonce,
    codeVerifier,
    createdAt: Date.now(),
  }
  try {
    window.sessionStorage.setItem(TRANSACTION_KEY, JSON.stringify(transaction))
  }
  catch {
    throw new Error('SSO transaction storage is unavailable')
  }

  window.location.assign(authorizationUrl)
}

export function consumeSsoRedirect(): SsoAuthorizationResult | Extract<SsoRedirectResult, { ok: false }> | null {
  if (typeof window === 'undefined' || !hasSsoRedirectResult(window.location.hash))
    return null

  const callbackHash = window.location.hash
  let stored = ''
  try {
    stored = window.sessionStorage.getItem(TRANSACTION_KEY) ?? ''
    window.sessionStorage.removeItem(TRANSACTION_KEY)
  }
  catch {
    stored = ''
  }
  stripRedirectHash()

  const transaction = parseTransaction(stored)
  if (!transaction
    || transaction.createdAt + TRANSACTION_TTL_MS <= Date.now()
    || new URL(transaction.redirectUri).origin !== window.location.origin) {
    return null
  }

  const result = parseSsoRedirectResult({
    hash: callbackHash,
    expectedNonce: transaction.nonce,
    expectedIssuer: transaction.issuer,
  })
  if (!result?.ok)
    return result

  return Object.freeze({
    ...result,
    clientId: transaction.clientId,
    scope: Object.freeze([...transaction.scope]),
    redirectUri: transaction.redirectUri,
    codeVerifier: transaction.codeVerifier,
  })
}

export async function adoptSsoCode(
  auth: SsoAdoptionAuth,
  authorization: SsoAuthorizationResult,
  options: SsoCodeExchangeOptions = {},
): Promise<boolean> {
  const scopes = readSsoScope(authorization.scope.join(' '))
  if (!/^[\w-]{43}$/.test(authorization.code)
    || !readSsoClientId(authorization.clientId)
    || !scopes.length
    || !readSsoRedirectUri(authorization.redirectUri)
    || !/^[\w-]{32,128}$/.test(authorization.nonce)
    || !isSsoPkceVerifier(authorization.codeVerifier)) {
    return false
  }

  const exchangeUrl = readSsoRedirectUri(options.exchangeUrl ?? YLF_DEFAULT_SSO_EXCHANGE_URL)
  if (!exchangeUrl)
    throw new TypeError('SSO exchange URL must use HTTPS')
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function')
    throw new TypeError('fetch is unavailable')

  await auth.signInWithCustomTicket(async () => {
    const response = await fetchImpl(exchangeUrl, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'exchangeSsoCode',
        clientId: authorization.clientId,
        redirectUri: authorization.redirectUri,
        scope: scopes.join(' '),
        code: authorization.code,
        nonce: authorization.nonce,
        codeVerifier: authorization.codeVerifier,
      }),
    })
    const payload = await response.json() as unknown
    if (!response.ok || !isTicketExchangeResponse(payload))
      throw new Error('SSO authorization code exchange failed')
    return payload.ticket
  })
  return true
}

function parseTransaction(raw: string): StoredTransaction | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredTransaction>
    const scopes = Array.isArray(value.scope) ? readSsoScope(value.scope.join(' ')) : []
    const issuer = typeof value.issuer === 'string' ? value.issuer : ''
    const clientId = readSsoClientId(value.clientId)
    const redirectUri = readSsoRedirectUri(value.redirectUri)
    const nonce = typeof value.nonce === 'string' ? value.nonce : ''
    const codeVerifier = typeof value.codeVerifier === 'string' ? value.codeVerifier : ''
    const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Number.NaN
    if (!issuer
      || new URL(issuer).origin !== issuer
      || !clientId
      || !scopes.length
      || !redirectUri
      || !/^[\w-]{32,128}$/.test(nonce)
      || !isSsoPkceVerifier(codeVerifier)
      || !Number.isSafeInteger(createdAt)) {
      return null
    }
    return {
      issuer,
      clientId,
      scope: scopes,
      redirectUri,
      nonce,
      codeVerifier,
      createdAt,
    }
  }
  catch {
    return null
  }
}

function isTicketExchangeResponse(value: unknown): value is { ok: true, ticket: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const record = value as Record<string, unknown>
  return record.ok === true
    && typeof record.ticket === 'string'
    && record.ticket.length > 0
    && !('access_token' in record)
    && !('refresh_token' in record)
    && !('session' in record)
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function stripRedirectHash(): void {
  const { origin, pathname, search } = window.location
  try {
    window.history.replaceState(window.history.state, '', `${origin}${pathname}${search}`)
  }
  catch {
    window.location.hash = ''
  }
}
