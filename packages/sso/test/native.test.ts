import { afterEach, describe, expect, it, vi } from 'vitest'
import { isInYunleApp, requestSsoNative } from '../src/native'

const g = globalThis as unknown as { window?: unknown, fetch?: unknown }
const originalFetch = g.fetch

function setBridge(ylf: unknown) {
  g.window = { ylf }
}

afterEach(() => {
  delete g.window
  g.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('isInYunleApp', () => {
  it('is false without a container bridge', () => {
    expect(isInYunleApp()).toBe(false) // no window at all
    setBridge({})
    expect(isInYunleApp()).toBe(false) // no inYunleApp flag
    setBridge({ inYunleApp: false })
    expect(isInYunleApp()).toBe(false)
  })

  it('is true when the container injects inYunleApp', () => {
    setBridge({ inYunleApp: true })
    expect(isInYunleApp()).toBe(true)
  })
})

describe('requestSsoNative', () => {
  const session = { access_token: 'at', refresh_token: 'rt' }

  it('returns not_authenticated outside the container', async () => {
    expect(await requestSsoNative()).toEqual({ ok: false, reason: 'not_authenticated' })
  })

  it('prefers getCloudbaseSession when the container provides it', async () => {
    setBridge({ inYunleApp: true, getCloudbaseSession: async () => session })
    expect(await requestSsoNative()).toEqual({ ok: true, session })
  })

  it('treats a session missing refresh_token as not authenticated', async () => {
    setBridge({ inYunleApp: true, getCloudbaseSession: async () => ({ access_token: 'at' }) })
    expect(await requestSsoNative()).toEqual({ ok: false, reason: 'not_authenticated' })
  })

  it('falls back to getAuthCode + exchange, surfacing sibling user into session.user', async () => {
    setBridge({ inYunleApp: true, getAuthCode: async () => ({ code: 'C' }) })
    const user = { id: 'u1', nickname: 'N', avatar: 'a.png' }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { session, user } }) }))
    g.fetch = fetchMock
    expect(await requestSsoNative({ exchangeUrl: 'https://apps.example/exchange' })).toEqual({
      ok: true,
      session: { ...session, user },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns not_authenticated when getAuthCode yields no code', async () => {
    setBridge({ inYunleApp: true, getAuthCode: async () => ({}) })
    expect(await requestSsoNative()).toEqual({ ok: false, reason: 'not_authenticated' })
  })

  it('returns error when the exchange request fails', async () => {
    setBridge({ inYunleApp: true, getAuthCode: async () => ({ code: 'C' }) })
    g.fetch = vi.fn(async () => ({ ok: false }))
    expect(await requestSsoNative()).toEqual({ ok: false, reason: 'error' })
  })
})
