/**
 * Pure Web SSO v3 protocol shared by the Provider and redirect Consumers.
 *
 * This is deliberately smaller than OIDC: it exposes one authorization-code +
 * PKCE redirect flow. Standard OIDC remains a separate adapter over the same
 * authorization core.
 */

export const SSO_QUERY_KEYS = {
  clientId: 'client_id',
  redirectUri: 'redirect_uri',
  scope: 'scope',
  nonce: 'nonce',
  codeChallenge: 'code_challenge',
  codeChallengeMethod: 'code_challenge_method',
} as const

export const SSO_REDIRECT_HASH_KEY = 'ylf_sso'

export type SsoFailureReason
  = | 'access_denied'
    | 'invalid_request'
    | 'not_authenticated'
    | 'server_error'

export interface SsoUrlSecurityOptions {
  // Reserved for source compatibility of protocol helpers; HTTP is never allowed.
}

export type SsoRedirectResult
  = | {
    ok: true
    code: string
    nonce: string
    issuer: string
  }
  | {
    ok: false
    reason: SsoFailureReason
  }

interface SsoRedirectPayload {
  nonce: string
  iss: string
  ok: boolean
  code?: string
  reason?: SsoFailureReason
}

const CLIENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/
const NONCE_RE = /^[\w-]{32,128}$/
const CODE_RE = /^[\w-]{43}$/
const PKCE_CHALLENGE_RE = /^[\w-]{43}$/
const PKCE_VERIFIER_RE = /^[\w.~-]{43,128}$/
const SCOPE_RE = /^[a-z][a-z0-9]*(?::[a-z][a-z0-9]*)?$/
const FAILURE_REASONS: readonly SsoFailureReason[] = [
  'access_denied',
  'invalid_request',
  'not_authenticated',
  'server_error',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function firstQueryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

export function readSsoClientId(raw: unknown): string {
  const value = firstQueryValue(raw).trim()
  return CLIENT_ID_RE.test(value) ? value : ''
}

export function readSsoScope(raw: unknown): string[] {
  const value = firstQueryValue(raw).trim()
  if (!value)
    return []
  const scopes = value.split(/\s+/)
  return scopes.every(scope => SCOPE_RE.test(scope))
    && new Set(scopes).size === scopes.length
    ? scopes
    : []
}

export function readSsoNonce(raw: unknown): string {
  const value = firstQueryValue(raw).trim()
  return NONCE_RE.test(value) ? value : ''
}

export function readSsoCodeChallenge(raw: unknown): string {
  const value = firstQueryValue(raw).trim()
  return PKCE_CHALLENGE_RE.test(value) ? value : ''
}

export function readSsoCodeChallengeMethod(raw: unknown): 'S256' | '' {
  return firstQueryValue(raw) === 'S256' ? 'S256' : ''
}

export function isSsoPkceVerifier(value: unknown): value is string {
  return typeof value === 'string' && PKCE_VERIFIER_RE.test(value)
}

export function isSecureSsoUrl(url: URL): boolean {
  return url.protocol === 'https:'
    && !url.username
    && !url.password
    && !url.hostname.endsWith('.')
}

export function readSsoRedirectUri(raw: unknown): string {
  const value = firstQueryValue(raw).trim()
  if (!value)
    return ''
  try {
    const url = new URL(value)
    if (!isSecureSsoUrl(url) || url.hash || url.toString() !== value)
      return ''
    return value
  }
  catch {
    return ''
  }
}

function readIssuer(raw: unknown): string {
  const value = firstQueryValue(raw).replace(/\/+$/, '')
  if (!value)
    return ''
  try {
    const url = new URL(value)
    return isSecureSsoUrl(url) && url.origin === value ? value : ''
  }
  catch {
    return ''
  }
}

export async function deriveSsoPkceChallenge(verifier: string): Promise<string> {
  if (!isSsoPkceVerifier(verifier))
    throw new TypeError('invalid PKCE verifier')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return bytesToBase64Url(new Uint8Array(digest))
}

export function buildSsoRequestUrl(input: {
  ssoOrigin: string
  clientId: string
  scope: readonly string[]
  redirectUri: string
  nonce: string
  codeChallenge: string
}): string {
  const issuer = readIssuer(input.ssoOrigin)
  const clientId = readSsoClientId(input.clientId)
  const scope = readSsoScope(input.scope.join(' '))
  const redirectUri = readSsoRedirectUri(input.redirectUri)
  const nonce = readSsoNonce(input.nonce)
  const codeChallenge = readSsoCodeChallenge(input.codeChallenge)
  if (!issuer || !clientId || !scope.length || !redirectUri || !nonce || !codeChallenge)
    throw new TypeError('invalid secure SSO request')

  const params = new URLSearchParams({
    [SSO_QUERY_KEYS.clientId]: clientId,
    [SSO_QUERY_KEYS.redirectUri]: redirectUri,
    [SSO_QUERY_KEYS.scope]: scope.join(' '),
    [SSO_QUERY_KEYS.nonce]: nonce,
    [SSO_QUERY_KEYS.codeChallenge]: codeChallenge,
    [SSO_QUERY_KEYS.codeChallengeMethod]: 'S256',
  })
  return `${issuer}/auth/sso?${params.toString()}`
}

export function hasSsoRedirectResult(hash: string): boolean {
  return readHashParam(hash, SSO_REDIRECT_HASH_KEY) !== ''
}

export function encodeSsoRedirectResult(input: {
  nonce: string
  issuer: string
  ok: boolean
  code?: string
  reason?: SsoFailureReason
}): string {
  const payload: SsoRedirectPayload = {
    nonce: input.nonce,
    iss: input.issuer,
    ok: input.ok,
    ...(input.code ? { code: input.code } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  }
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
}

export function parseSsoRedirectResult(input: {
  hash: string
  expectedNonce: string
  expectedIssuer: string
}): SsoRedirectResult | null {
  const encoded = readHashParam(input.hash, SSO_REDIRECT_HASH_KEY)
  const expectedIssuer = readIssuer(input.expectedIssuer)
  if (!encoded || !readSsoNonce(input.expectedNonce) || !expectedIssuer)
    return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as unknown
    if (!isRecord(payload)
      || payload.nonce !== input.expectedNonce
      || payload.iss !== expectedIssuer) {
      return null
    }
    if (payload.ok === true) {
      if (typeof payload.code === 'string'
        && CODE_RE.test(payload.code)
        && !('ticket' in payload)
        && !('session' in payload)
        && !('access_token' in payload)
        && !('refresh_token' in payload)) {
        return {
          ok: true,
          code: payload.code,
          nonce: input.expectedNonce,
          issuer: expectedIssuer,
        }
      }
      return { ok: false, reason: 'invalid_request' }
    }
    const reason = typeof payload.reason === 'string'
      && (FAILURE_REASONS as readonly string[]).includes(payload.reason)
      ? payload.reason as SsoFailureReason
      : 'server_error'
    return { ok: false, reason }
  }
  catch {
    return null
  }
}

export function isAnonymousSession(session: unknown): boolean {
  return isRecord(session)
    && isRecord(session.user)
    && session.user.is_anonymous === true
}

function bytesToBase64Url(input: Uint8Array): string {
  let binary = ''
  for (const byte of input)
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(input: string): Uint8Array {
  if (!/^[\w-]+$/.test(input))
    throw new TypeError('invalid base64url')
  const padding = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  const binary = atob(input.replace(/-/g, '+').replace(/_/g, '/') + padding)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function readHashParam(hash: string, key: string): string {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  for (const part of body.split('&')) {
    const separator = part.indexOf('=')
    if (separator < 0)
      continue
    try {
      if (decodeURIComponent(part.slice(0, separator)) === key)
        return decodeURIComponent(part.slice(separator + 1))
    }
    catch {
      return ''
    }
  }
  return ''
}
