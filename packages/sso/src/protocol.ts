/**
 * `@yunlefun/sso/protocol` —— 跨站 SSO 的纯协议层（同构，无 DOM 依赖）。
 *
 * Provider（主站 www.yunle.fun 的 `/auth/sso` 桥接页）与 Consumer（各子应用）都从这里 import，
 * 作为「消息契约 + 请求解析」的单一事实源，避免两端各写一份导致协议漂移。
 *
 * - Provider 端用：`readSsoMode` / `readSsoTargetOrigin` / `readSsoNonce` / `isAnonymousSession`。
 * - Consumer 端用：`buildSsoRequestUrl` / `parseSsoResultMessage`。
 * - 两端共用：`SSO_RESULT_TYPE` / `SSO_QUERY_KEYS` 与各类型。
 */

/** 回传消息的 type 字段 */
export const SSO_RESULT_TYPE = 'ylf:sso-result'

/** 请求 query 字段名，两端共用避免拼错 */
export const SSO_QUERY_KEYS = {
  mode: 'mode',
  targetOrigin: 'targetOrigin',
  nonce: 'nonce',
} as const

export type SsoMode = 'silent' | 'interactive'

export type SsoFailureReason
  = | 'not_authenticated'
    | 'invalid_request'
    | 'timeout'
    | 'popup_blocked'
    | 'closed'
    | 'error'

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
  /** ok === true 时携带的 CloudBase session */
  session?: unknown
}

/** Consumer 归一化后的结果 */
export type SsoResult
  = | { ok: true, session: SsoSession }
    | { ok: false, reason: SsoFailureReason }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Vue Router / URLSearchParams 的 query 值可能是 string | string[]，统一取首个并转字符串 */
export function firstQueryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

// ──────────────────────────── Provider 端：解析子站请求 ────────────────────────────

export function readSsoMode(raw: unknown): SsoMode {
  return firstQueryValue(raw) === 'interactive' ? 'interactive' : 'silent'
}

/** 解析并归一化 targetOrigin；非法或缺失时返回空串（视为非法请求） */
export function readSsoTargetOrigin(raw: unknown): string {
  const value = firstQueryValue(raw).trim()
  if (!value)
    return ''
  try {
    return new URL(value).origin
  }
  catch {
    return ''
  }
}

export function readSsoNonce(raw: unknown): string {
  return firstQueryValue(raw).trim()
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

/** 构造打开桥接页的 URL（query 自动编码） */
export function buildSsoRequestUrl(input: {
  ssoOrigin: string
  mode: SsoMode
  targetOrigin: string
  nonce: string
}): string {
  const origin = input.ssoOrigin.replace(/\/+$/, '')
  const params = new URLSearchParams({
    [SSO_QUERY_KEYS.mode]: input.mode,
    [SSO_QUERY_KEYS.targetOrigin]: input.targetOrigin,
    [SSO_QUERY_KEYS.nonce]: input.nonce,
  })
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

  if (data.ok === true && isRecord(data.session))
    return { ok: true, session: data.session as SsoSession }

  const reason: SsoFailureReason = data.reason === 'invalid_request'
    ? 'invalid_request'
    : 'not_authenticated'
  return { ok: false, reason }
}
