/**
 * `@yunlefun/sso` —— 子应用侧 SSO 客户端（浏览器环境）。
 *
 * 让任意前端「用云乐坊账号一处登录、各站免登」：打开主站桥接页、安全校验回传消息、
 * 把 CloudBase session 注入子应用自己的 SDK。详见 https://docs.yunle.fun 的 SSO 接入指南。
 */
import type { SsoMode, SsoResult, SsoSession } from './protocol'
import { buildSsoRequestUrl, parseSsoResultMessage } from './protocol'

/** 主站默认源 */
export const YLF_DEFAULT_SSO_ORIGIN = 'https://www.yunle.fun'

export interface SsoOptions {
  /** 主站源，默认 https://www.yunle.fun。本地联调可传 http://localhost:5173 等 */
  ssoOrigin?: string
  /** silent（默认）：隐藏 iframe 静默探测；interactive：弹窗，未登录时引导登录 */
  mode?: SsoMode
  /** 超时毫秒数。默认 silent 8000、interactive 120000 */
  timeoutMs?: number
}

/** 只依赖 setSession 的最小结构类型，避免强依赖具体 SDK 版本 */
export interface SsoSetSessionAuth {
  setSession: (params: { access_token: string, refresh_token: string }) => Promise<unknown>
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
 * 一站式：发起 SSO 并在成功后直接注入子应用登录态。
 * 是大多数子应用唯一需要调用的函数。
 */
export async function signInWithSso(
  auth: SsoSetSessionAuth,
  options?: SsoOptions,
): Promise<SsoResult> {
  const result = await requestSso(options)
  if (result.ok) {
    const adopted = await adoptSession(auth, result.session)
    if (!adopted)
      return { ok: false, reason: 'not_authenticated' }
  }
  return result
}
