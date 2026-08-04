import type { SsoFetch } from '../src/client'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adoptSsoCode,
  consumeSsoRedirect,
  startSsoRedirect,
} from '../src/client'
import * as publicApi from '../src/index'
import {
  encodeSsoRedirectResult,
  SSO_REDIRECT_HASH_KEY,
} from '../src/protocol'

const g = globalThis as unknown as { window?: unknown }
const TRANSACTION_KEY = 'ylf:sso:v3:transaction'
const VERIFIER = 'v'.repeat(43)

function mockWindow(init: {
  hash?: string
  origin?: string
  pathname?: string
  search?: string
  store?: Record<string, string>
} = {}) {
  const store = new Map<string, string>(Object.entries(init.store ?? {}))
  const assign = vi.fn()
  const replaceState = vi.fn()
  g.window = {
    location: {
      origin: init.origin ?? 'https://home.yunle.fun',
      pathname: init.pathname ?? '/',
      search: init.search ?? '',
      hash: init.hash ?? '',
      assign,
    },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    history: { state: null, replaceState },
  }
  return { assign, replaceState, store }
}

function transaction(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    issuer: 'https://www.yunle.fun',
    clientId: 'home-web',
    scope: ['identity:bootstrap'],
    redirectUri: 'https://home.yunle.fun/',
    nonce: 'n'.repeat(43),
    codeVerifier: VERIFIER,
    createdAt: Date.now(),
    ...overrides,
  })
}

afterEach(() => {
  delete g.window
  vi.restoreAllMocks()
})

describe('public API boundary', () => {
  it('keeps the root API limited to the redirect-code consumer', async () => {
    for (const removed of [
      'adoptSession',
      'adoptSsoResult',
      'adoptSsoTicket',
      'requestSso',
      'signInWithSso',
      'requestSsoNative',
      'parseSsoResultMessage',
    ]) {
      expect(removed in publicApi).toBe(false)
    }

    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest.exports).not.toHaveProperty('./legacy')
    expect(manifest.exports).toHaveProperty('./browser')
    expect(manifest.exports).toHaveProperty('./server')
  })
})

describe('startSsoRedirect', () => {
  it('requires clientId and scope, persists one bound transaction, then navigates top-level', async () => {
    const { assign, store } = mockWindow()
    await startSsoRedirect({
      clientId: 'home-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://home.yunle.fun/',
      ssoOrigin: 'https://www.yunle.fun',
    })

    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0]?.[0] as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.yunle.fun/auth/sso')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'home-web',
      redirect_uri: 'https://home.yunle.fun/',
      scope: 'identity:bootstrap',
      code_challenge_method: 'S256',
    })
    expect(url.searchParams.get('nonce')).toMatch(/^[\w-]{43}$/)
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)

    const saved = JSON.parse(store.get(TRANSACTION_KEY) ?? '{}')
    expect(saved).toMatchObject({
      issuer: 'https://www.yunle.fun',
      clientId: 'home-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://home.yunle.fun/',
      nonce: url.searchParams.get('nonce'),
    })
    expect(saved.codeVerifier).toMatch(/^[\w.~-]{43,128}$/)
  })

  it('fails closed when transaction storage is unavailable', async () => {
    const { assign } = mockWindow()
    const windowValue = g.window as { sessionStorage: { setItem: () => void } }
    windowValue.sessionStorage.setItem = () => {
      throw new Error('storage disabled')
    }

    await expect(startSsoRedirect({
      clientId: 'home-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://home.yunle.fun/',
    })).rejects.toThrow('transaction')
    expect(assign).not.toHaveBeenCalled()
  })

  it('keeps account selection as a provider interaction hint only', async () => {
    const { assign, store } = mockWindow()
    await startSsoRedirect({
      clientId: 'home-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://home.yunle.fun/',
      prompt: 'select_account',
    })

    const url = new URL(assign.mock.calls[0]?.[0] as string)
    expect(url.searchParams.get('prompt')).toBe('select_account')
    expect(JSON.parse(store.get(TRANSACTION_KEY) ?? '{}')).not.toHaveProperty('prompt')
  })
})

describe('consumeSsoRedirect', () => {
  it('returns a complete immutable exchange binding and consumes stored state', () => {
    const encoded = encodeSsoRedirectResult({
      nonce: 'n'.repeat(43),
      issuer: 'https://www.yunle.fun',
      ok: true,
      code: 'c'.repeat(43),
    })
    const { replaceState, store } = mockWindow({
      hash: `#${SSO_REDIRECT_HASH_KEY}=${encoded}`,
      store: { [TRANSACTION_KEY]: transaction() },
    })

    expect(consumeSsoRedirect()).toEqual({
      ok: true,
      code: 'c'.repeat(43),
      issuer: 'https://www.yunle.fun',
      clientId: 'home-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://home.yunle.fun/',
      nonce: 'n'.repeat(43),
      codeVerifier: VERIFIER,
    })
    expect(store.has(TRANSACTION_KEY)).toBe(false)
    expect(replaceState).toHaveBeenCalledTimes(1)
  })

  it('rejects issuer or nonce injection and still scrubs recognized callbacks', () => {
    const encoded = encodeSsoRedirectResult({
      nonce: 'n'.repeat(43),
      issuer: 'https://evil.example',
      ok: true,
      code: 'c'.repeat(43),
    })
    const { replaceState, store } = mockWindow({
      hash: `#${SSO_REDIRECT_HASH_KEY}=${encoded}`,
      store: { [TRANSACTION_KEY]: transaction() },
    })
    expect(consumeSsoRedirect()).toBeNull()
    expect(store.has(TRANSACTION_KEY)).toBe(false)
    expect(replaceState).toHaveBeenCalledTimes(1)
  })
})

describe('adoptSsoCode', () => {
  it('redeems every stored binding and passes only the transient ticket to CloudBase', async () => {
    const signInWithCustomTicket = vi.fn(async (getTicket: () => Promise<string>) => getTicket())
    const fetchImpl = vi.fn<SsoFetch>(async () => new Response(JSON.stringify({
      ok: true,
      ticket: 'cloudbase-ticket',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const adopted = await adoptSsoCode({ signInWithCustomTicket }, {
      ok: true,
      code: 'c'.repeat(43),
      issuer: 'https://www.yunle.fun',
      clientId: 'home-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://home.yunle.fun/',
      nonce: 'n'.repeat(43),
      codeVerifier: VERIFIER,
    }, { fetch: fetchImpl })

    expect(adopted).toBe(true)
    expect(signInWithCustomTicket).toHaveResolvedWith('cloudbase-ticket')
    const request = fetchImpl.mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toEqual({
      action: 'exchangeSsoCode',
      clientId: 'home-web',
      redirectUri: 'https://home.yunle.fun/',
      scope: 'identity:bootstrap',
      code: 'c'.repeat(43),
      nonce: 'n'.repeat(43),
      codeVerifier: VERIFIER,
    })
    expect(String(request?.body)).not.toContain('refresh_token')
  })

  it('rejects responses that contain session credentials', async () => {
    const signInWithCustomTicket = vi.fn(async (getTicket: () => Promise<string>) => getTicket())
    const fetchImpl = vi.fn<SsoFetch>(async () => new Response(JSON.stringify({
      ok: true,
      ticket: 'cloudbase-ticket',
      refresh_token: 'must-not-cross',
    }), { status: 200 }))

    await expect(adoptSsoCode({ signInWithCustomTicket }, {
      ok: true,
      code: 'c'.repeat(43),
      issuer: 'https://www.yunle.fun',
      clientId: 'home-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://home.yunle.fun/',
      nonce: 'n'.repeat(43),
      codeVerifier: VERIFIER,
    }, { fetch: fetchImpl })).rejects.toThrow('exchange failed')
  })
})
