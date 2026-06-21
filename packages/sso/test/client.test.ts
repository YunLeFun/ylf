import { afterEach, describe, expect, it, vi } from 'vitest'
import { adoptSsoResult, adoptSsoTicket, consumeSsoRedirect, startSsoRedirect } from '../src/client'
import { encodeSsoRedirectResult, SSO_REDIRECT_HASH_KEY } from '../src/protocol'

const session = { access_token: 'at', refresh_token: 'rt' }

const g = globalThis as unknown as { window?: unknown }
const NONCE_KEY = 'ylf:sso:redirect-nonce'

function mockWindow(init: { hash?: string, search?: string, store?: Record<string, string> } = {}) {
  const store = new Map<string, string>(Object.entries(init.store ?? {}))
  const assign = vi.fn()
  const replaceState = vi.fn()
  g.window = {
    location: {
      origin: 'https://wenta.example',
      pathname: '/deck',
      search: init.search ?? '',
      hash: init.hash ?? '',
      assign,
    },
    sessionStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k) ?? null : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    history: { state: null, replaceState },
  }
  return { assign, replaceState, store }
}

afterEach(() => {
  delete g.window
  vi.restoreAllMocks()
})

describe('adoptSsoResult', () => {
  it('prefers the custom-login ticket when the auth supports it (independent session)', async () => {
    const setSession = vi.fn(async () => undefined)
    const signInWithCustomTicket = vi.fn(async () => undefined)
    const ok = await adoptSsoResult({ setSession, signInWithCustomTicket }, { ok: true, session, ticket: 'tkt-1' })
    expect(ok).toBe(true)
    expect(signInWithCustomTicket).toHaveBeenCalledWith('tkt-1')
    expect(setSession).not.toHaveBeenCalled()
  })

  it('falls back to setSession when no ticket is present', async () => {
    const setSession = vi.fn(async () => undefined)
    const signInWithCustomTicket = vi.fn(async () => undefined)
    const ok = await adoptSsoResult({ setSession, signInWithCustomTicket }, { ok: true, session })
    expect(ok).toBe(true)
    expect(signInWithCustomTicket).not.toHaveBeenCalled()
    expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
  })

  it('falls back to setSession when the auth cannot use tickets (older SDK)', async () => {
    const setSession = vi.fn(async () => undefined)
    const ok = await adoptSsoResult({ setSession }, { ok: true, session, ticket: 'tkt-1' })
    expect(ok).toBe(true)
    expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
  })

  it('returns false when the fallback session lacks the required tokens', async () => {
    const setSession = vi.fn(async () => undefined)
    const ok = await adoptSsoResult({ setSession }, { ok: true, session: { access_token: 'at' } })
    expect(ok).toBe(false)
    expect(setSession).not.toHaveBeenCalled()
  })
})

describe('adoptSsoTicket', () => {
  it('signs in with the one-time ticket when supported', async () => {
    const signInWithCustomTicket = vi.fn(async () => undefined)
    expect(await adoptSsoTicket({ setSession: vi.fn(), signInWithCustomTicket }, 'tkt-1')).toBe(true)
    expect(signInWithCustomTicket).toHaveBeenCalledWith('tkt-1')
  })

  it('returns false without a ticket or without ticket support', async () => {
    const signInWithCustomTicket = vi.fn(async () => undefined)
    expect(await adoptSsoTicket({ setSession: vi.fn(), signInWithCustomTicket }, '')).toBe(false)
    expect(await adoptSsoTicket({ setSession: vi.fn() }, 'tkt-1')).toBe(false)
  })
})

describe('startSsoRedirect', () => {
  it('stores a nonce and navigates top-level to the redirect bridge URL', () => {
    const { assign, store } = mockWindow()
    startSsoRedirect({ ssoOrigin: 'https://www.yunle.fun' })
    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0][0] as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.yunle.fun/auth/sso')
    expect(url.searchParams.get('mode')).toBe('redirect')
    expect(url.searchParams.get('returnUrl')).toBe('https://wenta.example/deck')
    const nonce = url.searchParams.get('nonce') ?? ''
    expect(nonce).not.toBe('')
    expect(store.get(NONCE_KEY)).toBe(nonce) // nonce persisted for return-trip validation
  })
})

describe('consumeSsoRedirect', () => {
  it('parses a matching result, then clears the nonce and strips the hash', () => {
    const enc = encodeSsoRedirectResult({ nonce: 'n1', ok: true, ticket: 'tkt-1' })
    const { replaceState, store } = mockWindow({ hash: `#${SSO_REDIRECT_HASH_KEY}=${enc}`, store: { [NONCE_KEY]: 'n1' } })
    expect(consumeSsoRedirect()).toEqual({ ok: true, ticket: 'tkt-1' })
    expect(replaceState).toHaveBeenCalled()
    expect(store.has(NONCE_KEY)).toBe(false)
  })

  it('returns null when the URL has no redirect result', () => {
    mockWindow({ hash: '#room=abc' })
    expect(consumeSsoRedirect()).toBeNull()
  })

  it('returns null on a nonce mismatch but still clears the stored nonce', () => {
    const enc = encodeSsoRedirectResult({ nonce: 'n1', ok: true, ticket: 'tkt-1' })
    const { store } = mockWindow({ hash: `#${SSO_REDIRECT_HASH_KEY}=${enc}`, store: { [NONCE_KEY]: 'WRONG' } })
    expect(consumeSsoRedirect()).toBeNull()
    expect(store.has(NONCE_KEY)).toBe(false)
  })
})
