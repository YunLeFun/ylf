/**
 * `@yunlefun/sso` —— 子应用侧 SSO 客户端（浏览器环境）。
 *
 * 让任意前端「用云乐坊账号一处登录、各站免登」：打开主站桥接页、安全校验回传消息、
 * 把 CloudBase session 注入子应用自己的 SDK。详见 https://docs.yunle.fun 的 SSO 接入指南。
 */
import type { NativeSsoOptions } from './native'
import type { SsoMode, SsoRedirectResult, SsoResult, SsoSession } from './protocol'
import { isInYunleApp, requestSsoNative } from './native'
import { buildSsoRequestUrl, parseSsoRedirectResult, parseSsoResultMessage, SSO_REDIRECT_HASH_KEY } from './protocol'

/** 主站默认源 */
export const YLF_DEFAULT_SSO_ORIGIN = 'https://www.yunle.fun'

export interface SsoOptions {
  /** 主站源，默认 https://www.yunle.fun。本地联调可传 http://localhost:5173 等 */
  ssoOrigin?: string
  /** silent（默认）：隐藏 iframe 静默探测；interactive：弹窗，未登录时引导登录 */
  mode?: SsoMode
  /** 超时毫秒数。默认 silent 8000、interactive 120000 */
  timeoutMs?: number
  /** 云乐坊原生容器内的选项（仅 isInYunleApp() 为真时生效） */
  native?: NativeSsoOptions
}

/** 只依赖 setSession 的最小结构类型，避免强依赖具体 SDK 版本 */
export interface SsoSetSessionAuth {
  setSession: (params: { access_token: string, refresh_token: string }) => Promise<unknown>
  /**
   * 可选：CloudBase `signInWithCustomTicket`。提供且桥接下发了一次性 `ticket` 时，
   * `signInWithSso` / `adoptSsoResult` 会优先用它换取**子站自己的独立会话**（独立
   * refresh_token、同源可续期），而非复用主站会话 `setSession`。
   *
   * 注意：CloudBase js-sdk **v2** 的签名是接收一个**返回票据的函数**（`getTickFn`），
   * 不是票据字符串本身——传字符串会被当函数调用而同步抛错。
   */
  signInWithCustomTicket?: (getTicket: () => Promise<string>) => Promise<unknown>
}

function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 向主站发起一次 SSO 请求，拿回（或确认拿不到）登录态。
 * 不直接登录子应用，只负责取 session；注入交给 {@link adoptSession} / {@link signInWithSso}。
 */
export function requestSso(options: SsoOptions = {}): Promise<SsoResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    return Promise.resolve({ ok: false, reason: 'error' })

  const ssoOrigin = (options.ssoOrigin ?? YLF_DEFAULT_SSO_ORIGIN).replace(/\/+$/, '')
  const mode = options.mode ?? 'silent'
  const timeoutMs = options.timeoutMs ?? (mode === 'interactive' ? 120_000 : 8000)
  const nonce = createNonce()
  const url = buildSsoRequestUrl({ ssoOrigin, mode, targetOrigin: window.location.origin, nonce })

  return new Promise<SsoResult>((resolve) => {
    let settled = false
    let frame: HTMLIFrameElement | null = null
    let popup: Window | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let closedPoll: ReturnType<typeof setInterval> | null = null

    function cleanup() {
      window.removeEventListener('message', onMessage)
      if (timer)
        clearTimeout(timer)
      if (closedPoll)
        clearInterval(closedPoll)
      if (frame?.parentNode)
        frame.parentNode.removeChild(frame)
      if (popup && !popup.closed)
        popup.close()
    }

    function settle(result: SsoResult) {
      if (settled)
        return
      settled = true
      cleanup()
      resolve(result)
    }

    function onMessage(event: MessageEvent) {
      // 发起窗口校验：消息必须来自我们打开的 iframe / 弹窗本身
      const expectedSource = popup ?? frame?.contentWindow ?? null
      if (expectedSource && event.source !== expectedSource)
        return

      const result = parseSsoResultMessage({
        expectedOrigin: ssoOrigin,
        expectedNonce: nonce,
        eventOrigin: event.origin,
        data: event.data,
      })
      if (result)
        settle(result)
    }

    window.addEventListener('message', onMessage)
    timer = setTimeout(() => settle({ ok: false, reason: 'timeout' }), timeoutMs)

    if (mode === 'interactive') {
      popup = window.open(url, 'ylf-sso', 'width=480,height=640,menubar=no,toolbar=no,location=yes')
      if (!popup) {
        settle({ ok: false, reason: 'popup_blocked' })
        return
      }
      // 用户主动关闭弹窗时及时结束等待
      closedPoll = setInterval(() => {
        if (popup?.closed)
          settle({ ok: false, reason: 'closed' })
      }, 400)
    }
    else {
      frame = document.createElement('iframe')
      frame.setAttribute('aria-hidden', 'true')
      frame.title = 'YunLeFun SSO'
      frame.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;border:0;visibility:hidden;'
      frame.src = url
      document.body.appendChild(frame)
    }
  })
}

/**
 * 把主站回传的 session 注入子应用自己的 CloudBase SDK。
 * setSession 只需要 access_token + refresh_token；注入后子应用即变为登录态，uid 与主站一致。
 * @returns 是否成功注入（缺少必要 token 时返回 false）
 */
export async function adoptSession(
  auth: SsoSetSessionAuth,
  session: SsoSession,
): Promise<boolean> {
  if (!session.access_token || !session.refresh_token)
    return false
  await auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  return true
}

/**
 * 注入登录态：优先用桥接下发的一次性 `ticket` 走 `signInWithCustomTicket`（换取子站
 * 自己的独立可续期会话），否则回退到 `setSession`（复用主站会话）。
 *
 * 是 {@link signInWithSso} 的内部采用步骤，也单独导出，供「自行发 {@link requestSso}、
 * 自行采用会话」的子应用（如改用 `setCredentials` 适配的站点）复用同一套优先级。
 * @returns 是否成功注入
 */
export async function adoptSsoResult(
  auth: SsoSetSessionAuth,
  result: Extract<SsoResult, { ok: true }>,
): Promise<boolean> {
  if (result.ticket && typeof auth.signInWithCustomTicket === 'function') {
    // v2 API：传一个返回票据的函数，不是票据字符串。
    const ticket = result.ticket
    await auth.signInWithCustomTicket(() => Promise.resolve(ticket))
    return true
  }
  return adoptSession(auth, result.session)
}

/**
 * 一站式：发起 SSO 并在成功后直接注入子应用登录态。是大多数子应用唯一需要调用的函数。
 *
 * 自动选路：在云乐坊原生容器内（{@link isInYunleApp}）走 `window.ylf` 桥取会话；
 * 否则走 www.yunle.fun 的 postMessage 桥。注入优先用一次性 `ticket`（子站独立会话），
 * 否则回退到 `setSession`，调用方无需感知平台或凭证形态。
 */
export async function signInWithSso(
  auth: SsoSetSessionAuth,
  options: SsoOptions = {},
): Promise<SsoResult> {
  const result = isInYunleApp()
    ? await requestSsoNative(options.native)
    : await requestSso(options)
  if (result.ok) {
    const adopted = await adoptSsoResult(auth, result)
    if (!adopted)
      return { ok: false, reason: 'not_authenticated' }
  }
  return result
}

// ──────────────────────────── 重定向握手（业界标准，抗存储分区）────────────────────────────

const REDIRECT_NONCE_KEY = 'ylf:sso:redirect-nonce'

export interface RedirectSsoOptions {
  /** 主站源，默认 https://www.yunle.fun */
  ssoOrigin?: string
  /**
   * 登录完成后回跳的地址，默认当前页（去掉已有 hash，避免与回传 fragment 冲突）。
   * 其 origin 必须在主站 SSO 白名单内，否则桥接页会拒绝跳转。
   */
  returnUrl?: string
}

/**
 * 发起**顶层重定向**式 SSO（业界标准的抗存储分区方案）：整页跳到主站桥接页，登录确认后
 * 桥接页带一次性 ticket 跳回 `returnUrl`。本函数让页面导航走人、不会 resolve；回跳后在应用
 * 启动时调用 {@link consumeSsoRedirect} 取结果。
 *
 * 相比 {@link requestSso} 的隐藏 iframe / 弹窗：重定向每一跳都是第一方上下文，因此在
 * Safari ITP / 隐私模式等第三方存储被分区的环境里也能完成握手。
 */
export function startSsoRedirect(options: RedirectSsoOptions = {}): void {
  if (typeof window === 'undefined')
    return
  const ssoOrigin = (options.ssoOrigin ?? YLF_DEFAULT_SSO_ORIGIN).replace(/\/+$/, '')
  const nonce = createNonce()
  const { origin, pathname, search } = window.location
  const returnUrl = options.returnUrl ?? `${origin}${pathname}${search}`
  try {
    window.sessionStorage.setItem(REDIRECT_NONCE_KEY, nonce)
  }
  catch {
    // sessionStorage 不可用（隐私模式等）：仍可发起，但回跳会因无法校验 nonce 而被忽略；
    // 调用方应保留 popup / iframe 兜底。
  }
  window.location.assign(buildSsoRequestUrl({
    ssoOrigin,
    mode: 'redirect',
    targetOrigin: origin,
    nonce,
    returnUrl,
  }))
}

/**
 * 在应用启动时调用：若当前 URL 是一次 SSO 重定向回跳，解析并返回结果，同时**清理地址栏与暂存 nonce**
 * （避免一次性票据残留在历史/地址栏）。不是回跳（或 nonce 不匹配）则返回 null。
 * 成功后用 {@link adoptSsoTicket}（或 `auth.signInWithCustomTicket(() => Promise.resolve(result.ticket))`）采用登录态。
 */
export function consumeSsoRedirect(): SsoRedirectResult | null {
  if (typeof window === 'undefined')
    return null
  const { hash } = window.location
  if (!hash || !hash.includes(SSO_REDIRECT_HASH_KEY))
    return null

  let expectedNonce = ''
  try {
    expectedNonce = window.sessionStorage.getItem(REDIRECT_NONCE_KEY) ?? ''
  }
  catch {
    expectedNonce = ''
  }

  const result = parseSsoRedirectResult({ hash, expectedNonce })

  try {
    window.sessionStorage.removeItem(REDIRECT_NONCE_KEY)
  }
  catch {}
  if (result)
    stripRedirectHash()

  return result
}

/** 采用 redirect 链路拿到的一次性 ticket：换取子站自己的独立会话。 */
export async function adoptSsoTicket(auth: SsoSetSessionAuth, ticket: string): Promise<boolean> {
  if (!ticket || typeof auth.signInWithCustomTicket !== 'function')
    return false
  // v2 API：传一个返回票据的函数，不是票据字符串。
  await auth.signInWithCustomTicket(() => Promise.resolve(ticket))
  return true
}

function stripRedirectHash(): void {
  const { origin, pathname, search } = window.location
  const clean = `${origin}${pathname}${search}`
  try {
    window.history.replaceState(window.history.state, '', clean)
  }
  catch {
    window.location.hash = ''
  }
}
