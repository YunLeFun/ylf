import type { Buffer } from 'node:buffer'
import type { AuthTokenStore, StoredAuthSession } from './store'
import { createHash, randomBytes } from 'node:crypto'

export const DEFAULT_YLF_API_BASE_URL = 'https://admin.yunle.fun'

interface DeviceAuthorizationResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  token_type: 'Bearer'
  access_token: string
  expires_in: number
  refresh_token: string
  refresh_expires_in: number
}

interface OAuthErrorResponse {
  error: string
  error_description?: string
}

export interface DeviceLoginPrompt {
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
}

export class YlfAuthError extends Error {
  constructor(message: string, readonly code = 'auth_error') {
    super(message)
    this.name = 'YlfAuthError'
  }
}

export async function loginWithDeviceAuthorization(input: {
  store: AuthTokenStore
  apiBaseUrl?: string
  onPrompt: (prompt: DeviceLoginPrompt) => void | Promise<void>
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}): Promise<StoredAuthSession> {
  const fetcher = input.fetch ?? globalThis.fetch
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl ?? DEFAULT_YLF_API_BASE_URL)
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const authorization = await requestJson<DeviceAuthorizationResponse>(fetcher, `${apiBaseUrl}/api/cli-auth/device/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: 'ylf-cli',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
  })
  validateDeviceAuthorization(authorization)
  await input.onPrompt({
    userCode: authorization.user_code,
    verificationUri: authorization.verification_uri,
    verificationUriComplete: authorization.verification_uri_complete,
    expiresIn: authorization.expires_in,
  })

  const now = input.now ?? Date.now
  const sleep = input.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const deadline = now() + authorization.expires_in * 1000
  let interval = Math.max(1, authorization.interval) * 1000
  while (now() < deadline) {
    await sleep(interval)
    const response = await fetcher(`${apiBaseUrl}/api/cli-auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'ylf-cli',
        device_code: authorization.device_code,
        code_verifier: verifier,
      }),
    })
    const data = await parseResponse(response)
    if (response.ok) {
      const session = toStoredSession(data, apiBaseUrl, now())
      await input.store.save(session)
      return session
    }
    const oauthError = data as Partial<OAuthErrorResponse>
    if (oauthError.error === 'authorization_pending')
      continue
    if (oauthError.error === 'slow_down') {
      interval += 5_000
      continue
    }
    throw new YlfAuthError(
      oauthError.error_description || `设备授权失败：${oauthError.error || response.status}`,
      oauthError.error || 'device_authorization_failed',
    )
  }
  throw new YlfAuthError('设备授权已过期，请重新运行 ylf auth login', 'expired_token')
}

export async function refreshAuthSession(input: {
  store: AuthTokenStore
  session?: StoredAuthSession
  fetch?: typeof globalThis.fetch
  now?: () => number
}): Promise<StoredAuthSession> {
  const current = input.session ?? await input.store.load()
  if (!current)
    throw new YlfAuthError('尚未登录，请运行 ylf auth login', 'login_required')
  const now = input.now ?? Date.now
  if (current.refreshExpiresAt <= now()) {
    await input.store.clear()
    throw new YlfAuthError('登录会话已过期，请重新运行 ylf auth login', 'login_required')
  }
  const fetcher = input.fetch ?? globalThis.fetch
  const data = await requestJson<TokenResponse>(fetcher, `${current.apiBaseUrl}/api/cli-auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: 'ylf-cli',
      refresh_token: current.refreshToken,
    }),
  })
  const next = toStoredSession(data, current.apiBaseUrl, now())
  await input.store.save(next)
  return next
}

export async function getValidAccessToken(input: {
  store: AuthTokenStore
  fetch?: typeof globalThis.fetch
  now?: () => number
}): Promise<{ accessToken: string, session: StoredAuthSession }> {
  const current = await input.store.load()
  if (!current)
    throw new YlfAuthError('尚未登录，请运行 ylf auth login', 'login_required')
  const now = input.now ?? Date.now
  const session = current.accessExpiresAt > now() + 60_000
    ? current
    : await refreshAuthSession({ ...input, session: current })
  return { accessToken: session.accessToken, session }
}

export async function logoutAuthSession(input: {
  store: AuthTokenStore
  fetch?: typeof globalThis.fetch
}): Promise<void> {
  const session = await input.store.load()
  if (session) {
    const fetcher = input.fetch ?? globalThis.fetch
    await fetcher(`${session.apiBaseUrl}/api/cli-auth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken, client_id: 'ylf-cli' }),
    }).catch(() => undefined)
  }
  await input.store.clear()
}

async function requestJson<T>(fetcher: typeof globalThis.fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetcher(url, init)
  const data = await parseResponse(response)
  if (!response.ok) {
    const error = data as Partial<OAuthErrorResponse>
    throw new YlfAuthError(error.error_description || `请求失败：HTTP ${response.status}`, error.error)
  }
  return data as T
}

async function parseResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}))
}

function validateDeviceAuthorization(value: DeviceAuthorizationResponse): void {
  if (!value
    || typeof value.device_code !== 'string'
    || typeof value.user_code !== 'string'
    || typeof value.verification_uri !== 'string'
    || typeof value.verification_uri_complete !== 'string'
    || !Number.isSafeInteger(value.expires_in)
    || !Number.isSafeInteger(value.interval)) {
    throw new YlfAuthError('设备授权响应格式无效', 'invalid_response')
  }
}

function toStoredSession(value: unknown, apiBaseUrl: string, now: number): StoredAuthSession {
  const token = value as Partial<TokenResponse>
  if (token.token_type !== 'Bearer'
    || typeof token.access_token !== 'string'
    || typeof token.refresh_token !== 'string'
    || !Number.isSafeInteger(token.expires_in)
    || !Number.isSafeInteger(token.refresh_expires_in)) {
    throw new YlfAuthError('token 响应格式无效', 'invalid_response')
  }
  return {
    version: 1,
    apiBaseUrl,
    accessToken: token.access_token,
    accessExpiresAt: now + Number(token.expires_in) * 1000,
    refreshToken: token.refresh_token,
    refreshExpiresAt: now + Number(token.refresh_expires_in) * 1000,
  }
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new YlfAuthError('API 地址必须使用 HTTPS（本机开发地址除外）')
  return url.origin
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}
