import type { SsoFetch } from '../src/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adoptSsoCode, adoptSsoResult, adoptSsoTicket, consumeSsoRedirect, startSsoRedirect } from '../src/client'
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
    const signInWithCustomTicket = vi.fn(async (_getTicket: () => Promise<string>) => undefined)
    const ok = await adoptSsoResult({ setSession, signInWithCustomTicket }, { ok: true, session, ticket: 'tkt-1' })
    expect(ok).toBe(true)
    // v2 API: called with a ticket-provider function, not the raw string.
    expect(signInWithCustomTicket).toHaveBeenCalledTimes(1)
    const getTicket = signInWithCustomTicket.mock.calls[0]?.[0] as (() => Promise<string>) | undefined
    expect(typeof getTicket).toBe('function')
    expect(await getTicket?.()).toBe('tkt-1')
    expect(setSession).not.toHaveBeenCalled()
  })

  it('falls back to setSession when no ticket is present', async () => {
    const setSession = vi.fn(async () => undefined)
    const signInWithCustomTicket = vi.fn(async (_getTicket: () => Promise<string>) => undefined)
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
    const signInWithCustomTicket = vi.fn(async (_getTicket: () => Promise<string>) => undefined)
    expect(await adoptSsoTicket({ setSession: vi.fn(), signInWithCustomTicket }, 'tkt-1')).toBe(true)
    // v2 API: called with a ticket-provider function, not the raw string.
    const getTicket = signInWithCustomTicket.mock.calls[0]?.[0] as (() => Promise<string>) | undefined
    expect(typeof getTicket).toBe('function')
    expect(await getTicket?.()).toBe('tkt-1')
  })

  it('returns false without a ticket or without ticket support', async () => {
    const signInWithCustomTicket = vi.fn(async () => undefined)
    expect(await adoptSsoTicket({ setSession: vi.fn(), signInWithCustomTicket }, '')).toBe(false)
    expect(await adoptSsoTicket({ setSession: vi.fn() }, 'tkt-1')).toBe(false)
  })
})

describe('adoptSsoCode', () => {
  it('redeems the bound code once and passes only the returned ticket to the official SDK', async () => {
    const signInWithCustomTicket = vi.fn(async (getTicket: () => Promise<string>) => getTicket())
    const fetchImpl = vi.fn<SsoFetch>(async () => new Response(JSON.stringify({ ok: true, ticket: 'cloudbase-ticket' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const adopted = await adoptSsoCode(
      { signInWithCustomTicket },
      'c'.repeat(43),
      { nonce: 'n'.repeat(32), fetch: fetchImpl },
    )
    expect(adopted).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.yunle.fun/sso-ticket')
    expect(signInWithCustomTicket).toHaveResolvedWith('cloudbase-ticket')
    const request = fetchImpl.mock.calls[0]?.[1]
    expect(String(request?.body)).not.toContain('refresh_token')
  })

  it('rejects exchange responses that try to return a session or refresh token', async () => {
    const signInWithCustomTicket = vi.fn(async (getTicket: () => Promise<string>) => getTicket())
    const fetchImpl = vi.fn<SsoFetch>(async () => new Response(JSON.stringify({
      ok: true,
      ticket: 'cloudbase-ticket',
      refresh_token: 'must-not-cross',
    }), { status: 200 }))
    await expect(adoptSsoCode(
      { signInWithCustomTicket },
      'c'.repeat(43),
      { nonce: 'n'.repeat(32), fetch: fetchImpl },
    )).rejects.toThrow('exchange failed')
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
    const enc = encodeSsoRedirectResult({ nonce: 'n1', ok: true, code: 'c'.repeat(43) })
    const { replaceState, store } = mockWindow({ hash: `#${SSO_REDIRECT_HASH_KEY}=${enc}`, store: { [NONCE_KEY]: 'n1' } })
    expect(consumeSsoRedirect()).toEqual({ ok: true, code: 'c'.repeat(43), nonce: 'n1' })
    expect(replaceState).toHaveBeenCalled()
    expect(store.has(NONCE_KEY)).toBe(false)
  })

  it('returns a v2 authorization code with its validated nonce', () => {
    const enc = encodeSsoRedirectResult({ nonce: 'n'.repeat(32), ok: true, code: 'c'.repeat(43) })
    mockWindow({
      hash: `#${SSO_REDIRECT_HASH_KEY}=${enc}`,
      store: { [NONCE_KEY]: 'n'.repeat(32) },
    })
    expect(consumeSsoRedirect()).toEqual({ ok: true, code: 'c'.repeat(43), nonce: 'n'.repeat(32) })
  })

  it('returns null when the URL has no redirect result', () => {
    mockWindow({ hash: '#room=abc' })
    expect(consumeSsoRedirect()).toBeNull()
  })

  it('returns null on a nonce mismatch but still clears the stored nonce', () => {
    const enc = encodeSsoRedirectResult({ nonce: 'n1', ok: true, code: 'c'.repeat(43) })
    const { store } = mockWindow({ hash: `#${SSO_REDIRECT_HASH_KEY}=${enc}`, store: { [NONCE_KEY]: 'WRONG' } })
    expect(consumeSsoRedirect()).toBeNull()
    expect(store.has(NONCE_KEY)).toBe(false)
  })
})
