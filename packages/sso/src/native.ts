/**
 * 云乐坊原生容器（apps.yunle.fun，Capacitor）内的 SSO 适配器。
 *
 * 容器把宿主登录态（含 refresh_token）只保留在原生侧，向被打开的授信网页注入一座 JS 桥
 * `window.ylf`。本适配器据此取回**页面自己的**会话，与 web 桥一样，终点都是 `auth.setSession()`。
 *
 * 安全：页面全程不接触宿主的 refresh_token——拿到的是原生用宿主会话换来的、独立且可控的会话
 * （推荐 `getCloudbaseSession`，原生内部完成兑换；或一次性授权码 `getAuthCode` + 服务端兑换）。
 */
import type { SsoResult, SsoSession } from './protocol'

/** 申请会话的默认作用域 */
const DEFAULT_SCOPE = ['profile', 'cloudbase:session']

/** getAuthCode 兜底路径的默认兑换地址（需对子应用 origin 开启 CORS） */
const DEFAULT_EXCHANGE_URL = 'https://apps.yunle.fun/api/jsapi/auth/exchange'

/** apps.yunle.fun 原生容器注入页面的 JS 桥 `window.ylf` */
export interface YlfNativeBridge {
  /** 处于云乐坊原生容器内 */
  inYunleApp?: boolean
  /**
   * 推荐：原生内部完成「授权码 → 兑换」，直接返回可注入页面 SDK 的会话。
   * 页面不接触宿主凭证，也无需跨域兑换（无 CORS 顾虑）。
   */
  getCloudbaseSession?: (options?: { scope?: string[] }) => Promise<{ access_token?: string, refresh_token?: string } | null>
  /** 现有：返回一次性授权码，由页面向 `exchangeUrl` 兑换会话 */
  getAuthCode?: (options: { scope: string[] }) => Promise<{ code?: string }>
}

export interface NativeSsoOptions {
  /** 申请的会话作用域，默认 `['profile', 'cloudbase:session']` */
  scope?: string[]
  /**
   * 仅 `getAuthCode` 兜底路径使用：兑换授权码的**绝对**地址，
   * 默认 `https://apps.yunle.fun/api/jsapi/auth/exchange`。
   * 容器若实现了 `getCloudbaseSession` 则用不到它。
   */
  exchangeUrl?: string
}

function getBridge(): YlfNativeBridge | null {
  if (typeof window === 'undefined')
    return null
  const ylf = (window as unknown as { ylf?: YlfNativeBridge }).ylf
  return ylf && ylf.inYunleApp === true ? ylf : null
}

/** 是否运行在云乐坊原生容器内（容器注入了 `window.ylf.inYunleApp`） */
export function isInYunleApp(): boolean {
  return getBridge() !== null
}

async function exchangeAuthCode(code: string, exchangeUrl: string): Promise<SsoSession | null> {
  try {
    const res = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok)
      return null
    const json = await res.json() as { data?: { session?: SsoSession } }
    return json?.data?.session ?? null
  }
  catch {
    return null
  }
}

/**
 * 在原生容器内取回登录会话（只取不注入；注入交给 `adoptSession` / `signInWithSso`）。
 * 容器外或无桥时返回 `not_authenticated`。优先 `getCloudbaseSession`，否则 `getAuthCode` + 兑换。
 */
export async function requestSsoNative(options: NativeSsoOptions = {}): Promise<SsoResult> {
  const bridge = getBridge()
  if (!bridge)
    return { ok: false, reason: 'not_authenticated' }

  const scope = options.scope ?? DEFAULT_SCOPE

  // 1) 推荐路径：原生直接返回可注入的会话
  if (typeof bridge.getCloudbaseSession === 'function') {
    try {
      const session = await bridge.getCloudbaseSession({ scope })
      if (session?.access_token && session?.refresh_token)
        return { ok: true, session }
      return { ok: false, reason: 'not_authenticated' }
    }
    catch {
      return { ok: false, reason: 'error' }
    }
  }

  // 2) 兜底路径：一次性授权码 + 兑换
  if (typeof bridge.getAuthCode === 'function') {
    try {
      const { code } = await bridge.getAuthCode({ scope })
      if (!code)
        return { ok: false, reason: 'not_authenticated' }
      const session = await exchangeAuthCode(code, options.exchangeUrl ?? DEFAULT_EXCHANGE_URL)
      if (session?.access_token && session?.refresh_token)
        return { ok: true, session }
      return { ok: false, reason: 'error' }
    }
    catch {
      return { ok: false, reason: 'error' }
    }
  }

  return { ok: false, reason: 'not_authenticated' }
}
