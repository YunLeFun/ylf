/**
 * `@yunlefun/sso/protocol` —— 跨站 SSO 的纯协议层（同构，无 DOM 依赖）。
 *
 * Provider（主站 www.yunle.fun 的 `/auth/sso` 桥接页）与 Consumer（各子应用）都从这里 import，
 * 作为「消息契约 + 请求解析」的单一事实源，避免两端各写一份导致协议漂移。
 *
 * - Provider 端用：`readSsoMode` / `readSsoTargetOrigin` / `readSsoNonce` / `readSsoReturnUrl`
 *   / `isAnonymousSession` / `encodeSsoRedirectResult`。
 * - Consumer 端用：`buildSsoRequestUrl` / `parseSsoResultMessage` / `parseSsoRedirectResult`。
 * - 两端共用：`SSO_RESULT_TYPE` / `SSO_QUERY_KEYS` / `SSO_REDIRECT_HASH_KEY` 与各类型。
 */

/** 回传消息的 type 字段 */
export const SSO_RESULT_TYPE = 'ylf:sso-result'

/** 请求 query 字段名，两端共用避免拼错 */
export const SSO_QUERY_KEYS = {
  mode: 'mode',
  targetOrigin: 'targetOrigin',
  nonce: 'nonce',
  /** redirect 模式：登录完成后回跳的子站地址 */
  returnUrl: 'returnUrl',
  /** RFC 7636 / RFC 9700 PKCE S256 challenge. */
  codeChallenge: 'codeChallenge',
  codeChallengeMethod: 'codeChallengeMethod',
} as const

export type SsoMode = 'silent' | 'interactive' | 'redirect'

export type SsoFailureReason
  = | 'not_authenticated'
    | 'invalid_request'
    | 'timeout'
    | 'popup_blocked'
    | 'closed'
    | 'error'
    | 'not_configured'

/** CloudBase session（与 `@cloudbase/js-sdk` getSession() 返回一致） */
export interface SsoSession {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  user?: unknown
}

/** Provider 经 postMessage 回传给子站的消息 */
export interface SsoResultMessage {
  type: typeof SSO_RESULT_TYPE
  ok: boolean
  /** 原样回传请求方的 nonce，供消费端校验 */
  nonce: string
  reason?: 'invalid_request' | 'not_authenticated'
  /** v2：绑定请求方 origin 与 nonce 的一次性授权码。 */
  code?: string
  /** ok === true 时携带的 CloudBase session */
  session?: unknown
  /**
   * ok === true 时可附带的一次性自定义登录票据（CloudBase `createTicket`）。
   * 消费端优先用它 `signInWithCustomTicket` 换取**子站自己的独立会话**（独立
   * refresh_token、同源可续期、免疫第三方存储分区），而非复用主站会话。
   * 缺失时回退到 `session`，因此这是一个纯增量、向后兼容的字段。
   */
  ticket?: string
}

/** Consumer 归一化后的结果 */
export type SsoResult
  = | { ok: true, code: string, nonce: string, codeVerifier?: string }
    | { ok: true, session: SsoSession, ticket?: string }
    | { ok: false, reason: SsoFailureReason }

/** Explicit local-development exception for URL validation. */
export interface SsoUrlSecurityOptions {
  /** Permit plain HTTP only for loopback hosts. Defaults to false. */
  allowHttpLocalhost?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Vue Router / URLSearchParams 的 query 值可能是 string | string[]，统一取首个并转字符串 */
export function firstQueryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

// ──────────────────────────── Provider 端：解析子站请求 ────────────────────────────

export function readSsoMode(raw: unknown): SsoMode {
  const value = firstQueryValue(raw)
  if (value === 'interactive')
    return 'interactive'
  if (value === 'redirect')
    return 'redirect'
  return 'silent'
}

/** 解析并归一化 targetOrigin；非法或缺失时返回空串（视为非法请求） */
export function readSsoTargetOrigin(raw: unknown, options: SsoUrlSecurityOptions = {}): string {
  const value = firstQueryValue(raw).trim()
  if (!value)
    return ''
  try {
    const url = new URL(value)
    return isSecureSsoUrl(url, options) ? url.origin : ''
  }
  catch {
    return ''
  }
}

export function readSsoNonce(raw: unknown): string {
  const value = firstQueryValue(raw).trim()
  return /^[\w-]{32,128}$/.test(value) ? value : ''
}

/** Parse a PKCE S256 challenge. YunLeFun always derives it from 32 random bytes. */
export function readSsoCodeChallenge(raw: unknown): string {
  const value = firstQueryValue(raw).trim()
  return /^[\w-]{43}$/.test(value) ? value : ''
}

/** Accept only S256; plain PKCE is intentionally unsupported. */
export function readSsoCodeChallengeMethod(raw: unknown): 'S256' | '' {
  return firstQueryValue(raw) === 'S256' ? 'S256' : ''
}

/** Validate a high-entropy PKCE verifier. */
export function isSsoPkceVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.~-]{43,128}$/.test(value)
}

/** Derive the base64url SHA-256 PKCE challenge without exposing the verifier. */
export async function deriveSsoPkceChallenge(verifier: string): Promise<string> {
  if (!isSsoPkceVerifier(verifier))
    throw new TypeError('invalid PKCE verifier')
  if (!globalThis.crypto?.subtle)
    throw new TypeError('Web Crypto is unavailable')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return bytesToBase64Url(new Uint8Array(digest))
}

/**
 * 解析 redirect 模式的回跳地址。仅接受 http(s) 绝对 URL；非法/缺失返回空串。
 * 安全：调用方仍须校验其 origin 在白名单内，再用于跳转（防开放重定向）。
 */
export function readSsoReturnUrl(raw: unknown, options: SsoUrlSecurityOptions = {}): string {
  const value = firstQueryValue(raw).trim()
  if (!value)
    return ''
  try {
    const url = new URL(value)
    if (!isSecureSsoUrl(url, options))
      return ''
    // The callback fragment is owned by the SSO result. Do not carry caller-provided
    // fragments (which may contain application secrets) through the identity provider.
    url.hash = ''
    return url.toString()
  }
  catch {
    return ''
  }
}

/** True for HTTPS URLs, plus explicit loopback HTTP in local development. */
export function isSecureSsoUrl(url: URL, options: SsoUrlSecurityOptions = {}): boolean {
  if (url.username || url.password)
    return false
  if (url.protocol === 'https:')
    return true
  return options.allowHttpLocalhost === true
    && url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

/** Require redirect return URL and declared target to share the exact same origin. */
export function isSsoRedirectBoundToTarget(targetOrigin: string, returnUrl: string): boolean {
  if (!targetOrigin || !returnUrl)
    return false
  try {
    return new URL(returnUrl).origin === targetOrigin
  }
  catch {
    return false
  }
}

/**
 * 匿名 session（`user.is_anonymous === true`）一律按「未登录」处理：
 * 不能把匿名态当成已登录广播给子站。
 */
export function isAnonymousSession(session: unknown): boolean {
  if (!isRecord(session) || !isRecord(session.user))
    return false
  return session.user.is_anonymous === true
}

// ──────────────────────────── Consumer 端：构造请求 & 校验回传 ────────────────────────────

/** 构造打开桥接页的 URL（query 自动编码）。redirect 模式额外带上 `returnUrl`。 */
export function buildSsoRequestUrl(input: {
  ssoOrigin: string
  mode: SsoMode
  targetOrigin: string
  nonce: string
  codeChallenge: string
  returnUrl?: string
  allowHttpLocalhost?: boolean
}): string {
  const options = { allowHttpLocalhost: input.allowHttpLocalhost === true }
  const origin = readSsoTargetOrigin(input.ssoOrigin, options)
  const targetOrigin = readSsoTargetOrigin(input.targetOrigin, options)
  const nonce = readSsoNonce(input.nonce)
  const codeChallenge = readSsoCodeChallenge(input.codeChallenge)
  const returnUrl = input.returnUrl ? readSsoReturnUrl(input.returnUrl, options) : ''
  if (!origin || !targetOrigin || !nonce || !codeChallenge)
    throw new TypeError('invalid secure SSO request')
  if (input.mode === 'redirect' && (!returnUrl || !isSsoRedirectBoundToTarget(targetOrigin, returnUrl)))
    throw new TypeError('redirect return URL must match targetOrigin')
  const params = new URLSearchParams({
    [SSO_QUERY_KEYS.mode]: input.mode,
    [SSO_QUERY_KEYS.targetOrigin]: targetOrigin,
    [SSO_QUERY_KEYS.nonce]: nonce,
    [SSO_QUERY_KEYS.codeChallenge]: codeChallenge,
    [SSO_QUERY_KEYS.codeChallengeMethod]: 'S256',
  })
  if (returnUrl)
    params.set(SSO_QUERY_KEYS.returnUrl, returnUrl)
  return `${origin}/auth/sso?${params.toString()}`
}

/**
 * 校验并归一化桥接页回传的 postMessage。
 *
 * - `null`            —— 这条消息「不是给我们的」（origin/nonce/type 不匹配），调用方忽略即可。
 * - `{ ok: true }`    —— 同步成功，带 session。
 * - `{ ok: false }`   —— 是我们的结果但失败（未登录 / 非法请求）。
 *
 * 安全关键：origin 必须等于主站源、nonce 必须等于本次请求值。
 */
export function parseSsoResultMessage(input: {
  expectedOrigin: string
  expectedNonce: string
  eventOrigin: string
  data: unknown
}): SsoResult | null {
  const { expectedOrigin, expectedNonce, eventOrigin, data } = input

  if (eventOrigin !== expectedOrigin)
    return null
  if (!isRecord(data))
    return null
  if (data.type !== SSO_RESULT_TYPE)
    return null
  if (typeof data.nonce !== 'string' || data.nonce !== expectedNonce)
    return null

  if (data.ok === true && typeof data.code === 'string' && /^[\w-]{43}$/.test(data.code))
    return { ok: true, code: data.code, nonce: expectedNonce }

  if (data.ok === true && isRecord(data.session)) {
    const ticket = typeof data.ticket === 'string' && data.ticket ? data.ticket : undefined
    return ticket
      ? { ok: true, session: data.session as SsoSession, ticket }
      : { ok: true, session: data.session as SsoSession }
  }

  const reason: SsoFailureReason = data.reason === 'invalid_request'
    ? 'invalid_request'
    : 'not_authenticated'
  return { ok: false, reason }
}

// ──────────────────────────── 重定向握手（redirect 模式，抗存储分区的业界标准方案）────────────────────────────
//
// 顶层重定向每一跳都在各自源的第一方上下文里，因此免疫第三方 Cookie / 存储分区（Safari ITP 等）
// —— 这正是隐藏 iframe 静默 SSO 在现代浏览器里失效的根因。结果经**回跳 URL 的 fragment**
// （`#ylf_sso=<base64url(json)>`）回传：fragment 不发往服务器、不进 Referer。出于安全，redirect
// 链路只回传绑定 origin + nonce 的一次性授权码（绝不回传 CloudBase ticket、access token
// 或 refresh token）；消费端再通过 HTTPS POST 原子兑换并直接交给官方 SDK。

/** 回跳 URL fragment 中承载结果的键名 */
export const SSO_REDIRECT_HASH_KEY = 'ylf_sso'

/** redirect 链路的归一化结果（仅绑定的一次性授权码，无 ticket/session） */
export type SsoRedirectResult
  = | { ok: true, code: string, nonce: string, codeVerifier?: string }
    | { ok: false, reason: SsoFailureReason }

interface SsoRedirectPayload {
  nonce: string
  ok: boolean
  code?: string
  reason?: SsoFailureReason
}

const SSO_FAILURE_REASONS: readonly SsoFailureReason[] = [
  'not_authenticated',
  'invalid_request',
  'timeout',
  'popup_blocked',
  'closed',
  'error',
  'not_configured',
]

function isSsoFailureReason(value: unknown): value is SsoFailureReason {
  return typeof value === 'string' && (SSO_FAILURE_REASONS as readonly string[]).includes(value)
}

function bytesToBase64Url(input: Uint8Array): string {
  let binary = ''
  for (const byte of input)
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodeBase64Url(input: string): string {
  return bytesToBase64Url(new TextEncoder().encode(input))
}

function decodeBase64Url(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  return atob(input.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

function readHashParam(hash: string, key: string): string {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  for (const part of body.split('&')) {
    const eq = part.indexOf('=')
    if (eq === -1)
      continue
    try {
      if (decodeURIComponent(part.slice(0, eq)) === key)
        return decodeURIComponent(part.slice(eq + 1))
    }
    catch {
      continue
    }
  }
  return ''
}

/** True when the fragment contains a syntactically recognizable SSO result key. */
export function hasSsoRedirectResult(hash: string): boolean {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  return body.split('&').some((part) => {
    const eq = part.indexOf('=')
    if (eq === -1)
      return false
    try {
      return decodeURIComponent(part.slice(0, eq)) === SSO_REDIRECT_HASH_KEY
    }
    catch {
      return false
    }
  })
}

/**
 * Provider 端：把 redirect 结果编码为回跳 URL fragment 的值。
 * 调用方拼成 `<returnUrl>#${SSO_REDIRECT_HASH_KEY}=<本函数返回值>`。
 */
export function encodeSsoRedirectResult(payload: {
  nonce: string
  ok: boolean
  code?: string
  reason?: SsoFailureReason
}): string {
  const compact: SsoRedirectPayload = { nonce: payload.nonce, ok: payload.ok }
  if (payload.code)
    compact.code = payload.code
  if (payload.reason)
    compact.reason = payload.reason
  return encodeBase64Url(JSON.stringify(compact))
}

/**
 * Consumer 端：从回跳 URL 的 hash 中解析 redirect 结果。
 *
 * - `null`          —— hash 里没有本协议结果（或 nonce 不匹配 / 解码失败），调用方忽略即可。
 * - `{ ok: true }`  —— 成功，带 origin/nonce 绑定的一次性授权码。
 * - `{ ok: false }` —— 是本次结果但失败（未登录 / 非法 / 未配置票据等）。
 *
 * 安全关键：nonce 必须等于本次发起重定向时存下的值（防 CSRF / 结果注入）。
 */
export function parseSsoRedirectResult(input: { hash: string, expectedNonce: string }): SsoRedirectResult | null {
  const raw = readHashParam(input.hash, SSO_REDIRECT_HASH_KEY)
  if (!raw || !input.expectedNonce)
    return null

  let payload: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(decodeBase64Url(raw))
    payload = isRecord(parsed) ? parsed : null
  }
  catch {
    return null
  }
  if (!payload || payload.nonce !== input.expectedNonce)
    return null

  if (payload.ok === true && typeof payload.code === 'string' && /^[\w-]{43}$/.test(payload.code))
    return { ok: true, code: payload.code, nonce: input.expectedNonce }
  return { ok: false, reason: isSsoFailureReason(payload.reason) ? payload.reason : 'not_authenticated' }
}
