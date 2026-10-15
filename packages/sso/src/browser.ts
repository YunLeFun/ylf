import type { AcquisitionContext } from './acquisition'
import type {
  SsoAdoptionAuth,
  SsoAuthorizationResult,
  SsoCodeExchangeOptions,
} from './client'
import type {
  SsoPrompt,
} from './protocol'
import { sanitizeAcquisitionContext } from './acquisition'
import {
  adoptSsoCode,
  YLF_DEFAULT_SSO_ORIGIN,
} from './client'
import {
  deriveSsoPkceChallenge,
  readSsoClientId,
  readSsoRedirectUri,
  readSsoScope,
} from './protocol'

export type { SsoAuthorizationResult } from './client'

const SSO_CODE_RE = /^[\w-]{43}$/
const SSO_IDENTITY_ASSERTION_RE = /^\S{64,8192}$/

/** Minimal first-party host bridge exposed by the Yunle Apps container. */
export interface SsoHostBridge {
  authorize: (request: SsoHostAuthorizationRequest) => Promise<unknown>
  canIUse: (method: string) => Promise<unknown>
}

/** PKCE-bound request sent to a trusted first-party host. */
export interface SsoHostAuthorizationRequest {
  clientId: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  nonce: string
  redirectUri: string
  scope: readonly string[]
  prompt?: SsoPrompt
  acquisition?: AcquisitionContext
}

export interface HostSsoAuthorizationOptions {
  clientId: string
  scope: readonly string[]
  redirectUri: string
  ssoOrigin?: string
  prompt?: SsoPrompt
  acquisition?: AcquisitionContext
  /** Explicit bridge for tests or non-window runtimes. Defaults to `globalThis.ylf`. */
  host?: SsoHostBridge
}

export interface SsoIdentitySession {
  access_token?: string
  user?: { is_anonymous?: boolean }
}

/** CloudBase auth surface required to adopt a short-lived SSO identity. */
export interface SsoIdentityAdoptionAuth extends SsoAdoptionAuth {
  getSession: () => Promise<{
    data?: { session?: SsoIdentitySession }
    error?: unknown
  }>
}

/** Proof forwarded once to an application's same-origin BFF. */
export interface SsoIdentityProof {
  accessToken: string
  identityAssertion: string
  nonce: string
}

export class SsoIdentityAdoptionError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message)
    this.name = 'SsoIdentityAdoptionError'
  }
}

/**
 * Requests a one-time SSO authorization from a capable Yunle first-party host.
 *
 * Returns `null` outside a host container so callers can fall back to the
 * standard top-level redirect flow.
 */
export async function requestHostSsoAuthorization(
  options: HostSsoAuthorizationOptions,
): Promise<SsoAuthorizationResult | null> {
  const host = options.host ?? readDefaultHostBridge()
  if (!host)
    return null

  try {
    if (await host.canIUse('authorize') !== true)
      return null
  }
  catch {
    return null
  }

  const clientId = readSsoClientId(options.clientId)
  const scope = readSsoScope(options.scope.join(' '))
  const redirectUri = readSsoRedirectUri(options.redirectUri)
  const issuer = readExactOrigin(options.ssoOrigin ?? YLF_DEFAULT_SSO_ORIGIN)
  if (!clientId || !scope.length || !redirectUri || !issuer)
    throw new TypeError('Host SSO configuration is invalid')

  const codeVerifier = randomBase64Url(32)
  const nonce = randomBase64Url(32)
  const acquisition = sanitizeAcquisitionContext(options.acquisition)
  let response: unknown
  try {
    response = await host.authorize({
      clientId,
      codeChallenge: await deriveSsoPkceChallenge(codeVerifier),
      codeChallengeMethod: 'S256',
      nonce,
      redirectUri,
      scope,
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(acquisition ? { acquisition } : {}),
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/(?:^|\b)HOST_AUTH_DENIED(?:\b|$)/.test(message))
      throw new SsoIdentityAdoptionError('Host authorization was denied', 'access_denied')
    throw error
  }
  if (!isRecord(response)
    || response.ok !== true
    || typeof response.code !== 'string'
    || !SSO_CODE_RE.test(response.code)
    || response.issuer !== issuer) {
    throw new SsoIdentityAdoptionError('Host returned an invalid SSO authorization')
  }

  return Object.freeze({
    ok: true,
    code: response.code,
    issuer,
    clientId,
    scope: Object.freeze(scope),
    redirectUri,
    nonce,
    codeVerifier,
    ...(acquisition ? { acquisition } : {}),
  })
}

/**
 * Adopts a one-time authorization into an isolated CloudBase auth instance and
 * returns the two bound proofs required by an application BFF.
 *
 * The caller owns the auth instance and must sign it out in a `finally` block.
 */
export async function adoptSsoIdentityProof(
  auth: SsoIdentityAdoptionAuth,
  authorization: SsoAuthorizationResult,
  options: SsoCodeExchangeOptions = {},
): Promise<SsoIdentityProof> {
  const fetcher = options.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function')
    throw new TypeError('fetch is unavailable')

  let identityAssertion = ''
  let reason: string | undefined
  const captureFetch: typeof fetcher = async (input, init) => {
    const response = await fetcher(input, init)
    const payload: unknown = await response.clone().json().catch(() => null)
    if (isRecord(payload)) {
      if (typeof payload.identityAssertion === 'string')
        identityAssertion = payload.identityAssertion
      if (typeof payload.reason === 'string')
        reason = payload.reason
    }
    return response
  }

  try {
    const adopted = await adoptSsoCode(auth, authorization, {
      ...options,
      fetch: captureFetch,
    })
    if (!adopted)
      throw new SsoIdentityAdoptionError('SSO authorization is invalid')
    if (!SSO_IDENTITY_ASSERTION_RE.test(identityAssertion))
      throw new SsoIdentityAdoptionError('SSO identity assertion is missing')

    const { data, error } = await auth.getSession()
    const session = data?.session
    if (error
      || typeof session?.access_token !== 'string'
      || session.access_token.length < 16
      || session.access_token.length > 8192
      || /\s/.test(session.access_token)
      || session.user?.is_anonymous) {
      throw new SsoIdentityAdoptionError('SSO did not establish an authenticated identity')
    }
    return Object.freeze({
      accessToken: session.access_token,
      identityAssertion,
      nonce: authorization.nonce,
    })
  }
  catch (error) {
    if (error instanceof SsoIdentityAdoptionError && error.reason === reason)
      throw error
    throw new SsoIdentityAdoptionError(
      error instanceof Error ? error.message : 'SSO identity adoption failed',
      reason,
    )
  }
}

function readDefaultHostBridge(): SsoHostBridge | undefined {
  const candidate = (globalThis as typeof globalThis & { ylf?: unknown }).ylf
    ?? (globalThis as typeof globalThis & { window?: { ylf?: unknown } }).window?.ylf
  if (!isRecord(candidate)
    || typeof candidate.authorize !== 'function'
    || typeof candidate.canIUse !== 'function') {
    return undefined
  }
  return candidate as unknown as SsoHostBridge
}

function readExactOrigin(raw: string): string {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.hash
      && url.origin === raw
      ? url.origin
      : ''
  }
  catch {
    return ''
  }
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}
