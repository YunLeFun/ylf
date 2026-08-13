import type { YlfAuthError } from '../src/auth/client'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getValidAccessToken,
  loginWithDeviceAuthorization,
  refreshAuthSession,
} from '../src/auth/client'
import { FileAuthTokenStore } from '../src/auth/store'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function tokenStore() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ylf-auth-'))
  cleanup.push(directory)
  return new FileAuthTokenStore(path.join(directory, 'nested', 'auth.json'))
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ylf auth device flow', () => {
  it('uses PKCE, handles authorization_pending, and persists only the final session', async () => {
    const store = await tokenStore()
    const requests: Array<{ url: string, body: Record<string, unknown> }> = []
    const responses = [
      jsonResponse({
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://admin.yunle.fun/cli/activate',
        verification_uri_complete: 'https://admin.yunle.fun/cli/activate?user_code=ABCD-EFGH',
        expires_in: 600,
        interval: 1,
      }),
      jsonResponse({ error: 'authorization_pending' }, 400),
      jsonResponse({
        token_type: 'Bearer',
        access_token: 'access-token',
        expires_in: 900,
        refresh_token: 'refresh-token',
        refresh_expires_in: 2_592_000,
      }),
    ]
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : {},
      })
      return responses.shift()!
    }) as unknown as typeof fetch
    let time = 1_000
    const prompt = vi.fn()
    const session = await loginWithDeviceAuthorization({
      store,
      fetch: fetcher,
      now: () => time,
      sleep: async (milliseconds) => { time += milliseconds },
      onPrompt: prompt,
    })
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'ABCD-EFGH' }))
    expect(requests[0]?.body).toMatchObject({
      client_id: 'ylf-cli',
      code_challenge_method: 'S256',
    })
    expect(requests[0]?.body.code_challenge).toMatch(/^[\w-]{43}$/)
    expect(requests[1]?.body.code_verifier).toMatch(/^[\w-]{43}$/)
    expect(requests[1]?.body.code_verifier).not.toBe(requests[0]?.body.code_challenge)
    expect(session.accessToken).toBe('access-token')
    expect(await store.load()).toEqual(session)
    expect((await stat(store.location)).mode & 0o777).toBe(0o600)
    expect((await stat(path.dirname(store.location))).mode & 0o777).toBe(0o700)
  })

  it('rotates refresh tokens and automatically refreshes an expiring access token', async () => {
    const store = await tokenStore()
    await store.save({
      version: 1,
      apiBaseUrl: 'https://admin.yunle.fun',
      accessToken: 'old-access',
      accessExpiresAt: 1_001,
      refreshToken: 'old-refresh',
      refreshExpiresAt: 1_000_000,
    })
    const fetcher = vi.fn(async () => jsonResponse({
      token_type: 'Bearer',
      access_token: 'new-access',
      expires_in: 900,
      refresh_token: 'new-refresh',
      refresh_expires_in: 2_592_000,
    })) as unknown as typeof fetch
    const result = await getValidAccessToken({ store, fetch: fetcher, now: () => 1_000 })
    expect(result.accessToken).toBe('new-access')
    expect(result.session.refreshToken).toBe('new-refresh')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('clears an expired refresh session before refusing access', async () => {
    const store = await tokenStore()
    await store.save({
      version: 1,
      apiBaseUrl: 'https://admin.yunle.fun',
      accessToken: 'expired-access',
      accessExpiresAt: 1,
      refreshToken: 'expired-refresh',
      refreshExpiresAt: 2,
    })
    await expect(refreshAuthSession({ store, now: () => 3 })).rejects.toMatchObject<Partial<YlfAuthError>>({
      code: 'login_required',
    })
    expect(await store.load()).toBeNull()
  })
})
