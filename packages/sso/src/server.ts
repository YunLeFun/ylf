import type {
  CryptoKey,
  JWK,
  JWTVerifyGetKey,
  JWTVerifyOptions,
  KeyObject,
} from 'jose'
import { Buffer } from 'node:buffer'
import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
} from 'jose'

const IDENTITY_ASSERTION_TYPE = 'ylf-identity+jwt'
const IDENTITY_ASSERTION_MAX_AGE_SECONDS = 300
const SSO_NONCE_RE = /^[\w-]{32,128}$/
const IDENTIFIER_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/
const CLOUDBASE_ENV_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i

export interface SsoIdentityProofInput {
  accessToken: unknown
  identityAssertion: unknown
  nonce: unknown
}

export interface SsoIdentityVerificationConfig {
  cloudbaseEnvId: string
  appId: string
  clientId: string
  issuer: string
  jwksUrl: string
  requiredScope?: string
  requireVerifiedPhone?: boolean
}

export interface VerifiedSsoIdentity {
  userId: string
  handle?: string
  displayName?: string
  avatarUrl?: string
  phoneVerified: true
  accountStatus: 'active'
}

export type SsoIdentityProofErrorCode
  = | 'INVALID_INPUT'
    | 'AUTH_REQUIRED'
    | 'FORBIDDEN'
    | 'NOT_CONFIGURED'
    | 'SERVICE_UNAVAILABLE'

export class SsoIdentityProofError extends Error {
  constructor(
    readonly statusCode: 400 | 401 | 403 | 503,
    readonly code: SsoIdentityProofErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SsoIdentityProofError'
  }
}

type IdentityKey
  = | CryptoKey
    | KeyObject
    | JWK
    | Uint8Array
    | JWTVerifyGetKey

export interface SsoIdentityVerificationDependencies {
  fetch?: SsoServerFetch
  identityKey?: IdentityKey
}

export type SsoServerFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

class IdentityProviderUnavailableError extends Error {}

const remoteJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/**
 * Verifies both a CloudBase access token and the short-lived Yunle identity
 * assertion, including exact subject/client/app/scope/nonce binding.
 */
export async function verifySsoIdentityProof(
  proof: SsoIdentityProofInput,
  config: SsoIdentityVerificationConfig,
  dependencies: SsoIdentityVerificationDependencies = {},
): Promise<VerifiedSsoIdentity> {
  const accessToken = readAccessToken(proof.accessToken)
  const identityAssertion = readIdentityAssertion(proof.identityAssertion)
  const nonce = readNonce(proof.nonce)
  const normalized = readVerificationConfig(config)
  const fetcher = dependencies.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw new SsoIdentityProofError(
      503,
      'SERVICE_UNAVAILABLE',
      'CloudBase authentication is unavailable',
    )
  }

  let response: Response
  try {
    response = await fetcher(
      `https://${normalized.cloudbaseEnvId}.api.tcloudbasegateway.com/auth/v1/user/me`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5_000),
      },
    )
  }
  catch {
    throw new SsoIdentityProofError(
      503,
      'SERVICE_UNAVAILABLE',
      'CloudBase authentication is unavailable',
    )
  }
  if (!response.ok)
    throw new SsoIdentityProofError(401, 'AUTH_REQUIRED', 'CloudBase access proof is invalid')

  const profile: unknown = await response.json().catch(() => null)
  if (!isRecord(profile) || isAnonymous(profile, decodeJwtPayload(accessToken))) {
    throw new SsoIdentityProofError(
      401,
      'AUTH_REQUIRED',
      'Authenticated non-anonymous user is required',
    )
  }

  const userId = firstString([profile], 'sub', 'uid', 'id')
  if (!userId || userId.length > 128 || /\p{Cc}/u.test(userId))
    throw new SsoIdentityProofError(401, 'AUTH_REQUIRED', 'CloudBase user has no valid subject')

  await verifyIdentityAssertion(
    identityAssertion,
    nonce,
    userId,
    normalized,
    dependencies.identityKey,
    fetcher,
  )
  if (accountIsSuspended(profile))
    throw new SsoIdentityProofError(403, 'FORBIDDEN', 'The YunLeFun account is not active')

  const identityRecords = [
    profile,
    ...(isRecord(profile.user_metadata) ? [profile.user_metadata] : []),
  ]
  const handle = boundedString(firstString(identityRecords, 'handle', 'username', 'preferred_username'), 64)
  const displayName = boundedString(firstString(identityRecords, 'name', 'nickname'), 128)
  const avatarUrl = boundedString(firstString(identityRecords, 'avatarUrl', 'picture', 'avatar_url'), 2048)
  return Object.freeze({
    userId,
    ...(handle ? { handle } : {}),
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    phoneVerified: true,
    accountStatus: 'active',
  })
}

async function verifyIdentityAssertion(
  assertion: string,
  expectedNonce: string,
  userId: string,
  config: ReturnType<typeof readVerificationConfig>,
  identityKey?: IdentityKey,
  fetcher: SsoServerFetch = globalThis.fetch,
): Promise<void> {
  let verified
  try {
    const key = identityKey ?? remoteIdentityKeys(new URL(config.jwksUrl), fetcher)
    const options: JWTVerifyOptions = {
      algorithms: ['EdDSA'],
      audience: config.clientId,
      clockTolerance: 30,
      issuer: config.issuer,
      maxTokenAge: IDENTITY_ASSERTION_MAX_AGE_SECONDS,
      requiredClaims: ['iat', 'nbf', 'exp', 'jti', 'sub'],
      typ: IDENTITY_ASSERTION_TYPE,
    }
    verified = typeof key === 'function'
      ? await jwtVerify(assertion, key, options)
      : await jwtVerify(assertion, key, options)
  }
  catch (error) {
    if (error instanceof IdentityProviderUnavailableError) {
      throw new SsoIdentityProofError(
        503,
        'SERVICE_UNAVAILABLE',
        'YunLeFun SSO verification is unavailable',
      )
    }
    throw new SsoIdentityProofError(
      401,
      'AUTH_REQUIRED',
      'YunLeFun identity assertion is invalid',
    )
  }

  const { payload, protectedHeader } = verified
  const scopes = Array.isArray(payload.scope) ? payload.scope : []
  if (typeof protectedHeader.kid !== 'string'
    || !protectedHeader.kid
    || payload.sub !== userId
    || payload.aud !== config.clientId
    || payload.nonce !== expectedNonce
    || payload.app_id !== config.appId
    || scopes.length !== 1
    || scopes[0] !== config.requiredScope
    || typeof payload.iat !== 'number'
    || typeof payload.nbf !== 'number'
    || payload.nbf !== payload.iat
    || typeof payload.exp !== 'number'
    || payload.exp <= payload.iat
    || payload.exp - payload.iat > IDENTITY_ASSERTION_MAX_AGE_SECONDS
    || typeof payload.jti !== 'string'
    || !payload.jti) {
    throw new SsoIdentityProofError(
      401,
      'AUTH_REQUIRED',
      'YunLeFun identity assertion does not match this application',
    )
  }
  if (config.requireVerifiedPhone && payload.phone_number_verified !== true) {
    throw new SsoIdentityProofError(
      403,
      'FORBIDDEN',
      'A verified YunLeFun phone number is required',
    )
  }
  if (payload.account_status !== 'active')
    throw new SsoIdentityProofError(403, 'FORBIDDEN', 'The YunLeFun account is not active')
}

function remoteIdentityKeys(
  url: URL,
  fetcher: SsoServerFetch,
): ReturnType<typeof createRemoteJWKSet> {
  const usesGlobalFetch = fetcher === globalThis.fetch
  const existing = usesGlobalFetch ? remoteJwks.get(url.href) : undefined
  if (existing)
    return existing
  const keys = createRemoteJWKSet(url, {
    cacheMaxAge: 5 * 60_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
    [customFetch]: async (input, init) => {
      try {
        const response = await fetcher(input, init)
        if (!response.ok)
          throw new IdentityProviderUnavailableError()
        return response
      }
      catch (error) {
        if (error instanceof IdentityProviderUnavailableError)
          throw error
        throw new IdentityProviderUnavailableError()
      }
    },
  })
  if (usesGlobalFetch)
    remoteJwks.set(url.href, keys)
  return keys
}

function readVerificationConfig(config: SsoIdentityVerificationConfig) {
  const issuer = readSecureUrl(config.issuer, true)?.origin
  const jwksUrl = readSecureUrl(config.jwksUrl)?.href
  const requiredScope = config.requiredScope ?? 'identity:bootstrap'
  if (!CLOUDBASE_ENV_RE.test(config.cloudbaseEnvId)
    || !IDENTIFIER_RE.test(config.appId)
    || !IDENTIFIER_RE.test(config.clientId)
    || !issuer
    || !jwksUrl
    || !/^[a-z][a-z0-9:_-]{1,127}$/.test(requiredScope)) {
    throw new SsoIdentityProofError(
      503,
      'NOT_CONFIGURED',
      'SSO identity verification is not configured',
    )
  }
  return {
    cloudbaseEnvId: config.cloudbaseEnvId,
    appId: config.appId,
    clientId: config.clientId,
    issuer,
    jwksUrl,
    requiredScope,
    requireVerifiedPhone: config.requireVerifiedPhone !== false,
  }
}

function readAccessToken(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 16
    || value.length > 8192
    || /\s/.test(value)) {
    throw new SsoIdentityProofError(400, 'INVALID_INPUT', 'CloudBase access proof is invalid')
  }
  return value
}

function readIdentityAssertion(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 64
    || value.length > 8192
    || /\s/.test(value)) {
    throw new SsoIdentityProofError(400, 'INVALID_INPUT', 'YunLeFun identity assertion is invalid')
  }
  return value
}

function readNonce(value: unknown): string {
  if (typeof value !== 'string' || !SSO_NONCE_RE.test(value))
    throw new SsoIdentityProofError(400, 'INVALID_INPUT', 'YunLeFun SSO nonce is invalid')
  return value
}

function readSecureUrl(raw: string, originOnly = false): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:'
      || url.username
      || url.password
      || url.hash
      || url.hostname.endsWith('.')
      || (originOnly && url.origin !== raw)) {
      return null
    }
    return url
  }
  catch {
    return null
  }
}

function accountIsSuspended(profile: Record<string, unknown>): boolean {
  const status = firstString([profile], 'accountStatus', 'account_status', 'status')?.toLowerCase()
  return profile.disabled === true
    || profile.banned === true
    || profile.suspended === true
    || ['disabled', 'banned', 'blocked', 'suspended', 'deleted'].includes(status ?? '')
}

/** Detects anonymous users after CloudBase has validated the access token. */
export function isAnonymousCloudBaseIdentity(
  profile: Record<string, unknown>,
  token: Record<string, unknown> | null,
): boolean {
  return isAnonymous(profile, token)
}

function isAnonymous(
  profile: Record<string, unknown>,
  token: Record<string, unknown> | null,
): boolean {
  const metadata = isRecord(profile.app_metadata)
    ? profile.app_metadata
    : isRecord(token?.app_metadata) ? token.app_metadata : null
  return profile.is_anonymous === true
    || token?.is_anonymous === true
    || firstString([profile], 'loginType', 'login_type')?.toUpperCase() === 'ANONYMOUS'
    || firstString([profile], 'scope') === 'anonymous'
    || firstString(token ? [token] : [], 'scope') === 'anonymous'
    || firstString(metadata ? [metadata] : [], 'provider') === 'anonymous'
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload)
    return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return isRecord(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

function boundedString(value: string | undefined, maxLength: number): string | undefined {
  return value && value.length <= maxLength && !/\p{Cc}/u.test(value)
    ? value
    : undefined
}

function firstString(
  records: readonly Record<string, unknown>[],
  ...keys: string[]
): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim())
        return value.trim()
    }
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}
