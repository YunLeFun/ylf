import type { H3Event } from 'h3'
import { deleteCookie, getCookie, getHeader, setCookie } from 'h3'
import { SessionError, verifySessionCsrfToken } from './index'

/** Configuration for a host-only application session cookie. */
export interface H3SessionCookieConfig {
  /** Must start with `__Host-`; for example `__Host-ylf-drive-session`. */
  name: `__Host-${string}`
}

/** Origin allowlist used for cookie-authenticated unsafe requests. */
export interface H3OriginPolicy {
  /** Exact serialized origins. Production origins must use HTTPS. */
  allowedOrigins: readonly string[]
  /** Explicit local-development exception. Defaults to false. */
  allowHttpLocalhost?: boolean
}

/** Inputs required for session-bound CSRF validation. */
export interface H3CsrfValidationInput {
  sessionToken: string
  csrfToken: string | undefined
  platformSecret: string | Uint8Array
  scope?: string
}

function assertCookieName(name: string): asserts name is `__Host-${string}` {
  if (!/^__Host-[\w-]+$/.test(name))
    throw new SessionError('INVALID_INPUT', 'session cookie name must use the __Host- prefix')
}

function normalizeAllowedOrigin(origin: string, allowHttpLocalhost: boolean): string {
  let parsed: URL
  try {
    parsed = new URL(origin)
  }
  catch {
    throw new SessionError('INVALID_INPUT', `invalid allowed origin: ${origin}`)
  }
  const isLocalHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(allowHttpLocalhost && isLocalHttp))
    throw new SessionError('INVALID_INPUT', `allowed origin must use HTTPS: ${origin}`)
  if (parsed.origin !== origin)
    throw new SessionError('INVALID_INPUT', `allowed origin must not include a path: ${origin}`)
  return parsed.origin
}

/** Read the opaque bearer from a host-only cookie. */
export function readSessionCookie(event: H3Event, config: H3SessionCookieConfig): string | undefined {
  assertCookieName(config.name)
  return getCookie(event, config.name)
}

/** Write a Secure, HttpOnly, Path=/, SameSite=Lax host-only cookie. */
export function writeSessionCookie(
  event: H3Event,
  config: H3SessionCookieConfig,
  token: string,
  maxAgeSeconds: number,
): void {
  assertCookieName(config.name)
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0)
    throw new SessionError('INVALID_INPUT', 'cookie maxAgeSeconds must be a positive safe integer')
  setCookie(event, config.name, token, {
    secure: true,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: maxAgeSeconds,
  })
}

/** Delete a host-only session cookie with exactly matching attributes. */
export function clearSessionCookie(event: H3Event, config: H3SessionCookieConfig): void {
  assertCookieName(config.name)
  deleteCookie(event, config.name, {
    secure: true,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
  })
}

/** Require an exact allowlisted Origin for a cookie-authenticated unsafe request. */
export function assertRequestOrigin(event: H3Event, policy: H3OriginPolicy): string {
  const origin = getHeader(event, 'origin')
  if (!origin || origin === 'null')
    throw new SessionError('FORBIDDEN', 'request Origin is required')
  const allowed = policy.allowedOrigins.map(value => normalizeAllowedOrigin(value, policy.allowHttpLocalhost === true))
  if (!allowed.includes(origin))
    throw new SessionError('FORBIDDEN', 'request Origin is not allowed')
  return origin
}

/** Require a valid session-bound CSRF header value. */
export function assertSessionCsrf(input: H3CsrfValidationInput): void {
  if (!input.csrfToken || !verifySessionCsrfToken(
    input.csrfToken,
    input.sessionToken,
    input.platformSecret,
    input.scope,
  )) {
    throw new SessionError('FORBIDDEN', 'invalid CSRF token')
  }
}
