import type { SsoAuthorizationResult } from '../src/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adoptSsoIdentityProof,
  requestHostSsoAuthorization,
  SsoIdentityAdoptionError,
} from '../src/browser'

const authorization = {
  ok: true,
  code: 'c'.repeat(43),
  issuer: 'https://www.yunle.fun',
  clientId: 'cms-web',
  scope: ['identity:bootstrap'],
  redirectUri: 'https://cms.yunle.fun/',
  nonce: 'n'.repeat(43),
  codeVerifier: 'v'.repeat(43),
} satisfies SsoAuthorizationResult

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestHostSsoAuthorization', () => {
  it('returns null when no capable first-party host exists', async () => {
    vi.stubGlobal('window', {})
    await expect(requestHostSsoAuthorization({
      clientId: 'cms-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://cms.yunle.fun/',
    })).resolves.toBeNull()
  })

  it('binds the host code to the exact client, issuer, nonce, and PKCE verifier', async () => {
    const authorize = vi.fn(async () => ({
      ok: true,
      code: 'c'.repeat(43),
      issuer: 'https://www.yunle.fun',
    }))
    const result = await requestHostSsoAuthorization({
      clientId: 'cms-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://cms.yunle.fun/',
      host: {
        canIUse: vi.fn(async () => true),
        authorize,
      },
    })

    expect(result).toMatchObject({
      ok: true,
      code: 'c'.repeat(43),
      clientId: 'cms-web',
      issuer: 'https://www.yunle.fun',
      nonce: expect.stringMatching(/^[\w-]{43}$/),
      codeVerifier: expect.stringMatching(/^[\w-]{43}$/),
    })
    expect(authorize).toHaveBeenCalledWith({
      clientId: 'cms-web',
      codeChallenge: expect.stringMatching(/^[\w-]{43}$/),
      codeChallengeMethod: 'S256',
      nonce: result?.nonce,
      redirectUri: 'https://cms.yunle.fun/',
      scope: ['identity:bootstrap'],
    })
  })

  it('rejects a response issued by a different identity provider', async () => {
    await expect(requestHostSsoAuthorization({
      clientId: 'cms-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://cms.yunle.fun/',
      host: {
        canIUse: vi.fn(async () => true),
        authorize: vi.fn(async () => ({
          ok: true,
          code: 'c'.repeat(43),
          issuer: 'https://evil.example',
        })),
      },
    })).rejects.toBeInstanceOf(SsoIdentityAdoptionError)
  })
})

describe('adoptSsoIdentityProof', () => {
  it('returns only the access proof, signed assertion, and bound nonce', async () => {
    const auth = {
      signInWithCustomTicket: vi.fn(async (getTicket: () => Promise<string>) => getTicket()),
      getSession: vi.fn(async () => ({
        data: {
          session: {
            access_token: 'cloudbase-access-token',
            user: { is_anonymous: false },
          },
        },
      })),
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      ticket: 'cloudbase-ticket',
      identityAssertion: 'a'.repeat(64),
    }), { status: 200 }))

    await expect(adoptSsoIdentityProof(auth, authorization, {
      fetch: fetcher,
    })).resolves.toEqual({
      accessToken: 'cloudbase-access-token',
      identityAssertion: 'a'.repeat(64),
      nonce: authorization.nonce,
    })
  })

  it('preserves a provider reason without accepting an incomplete exchange', async () => {
    const auth = {
      signInWithCustomTicket: vi.fn(async (getTicket: () => Promise<string>) => getTicket()),
      getSession: vi.fn(),
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      reason: 'phone_verification_required',
    }), { status: 403 }))

    await expect(adoptSsoIdentityProof(auth, authorization, {
      fetch: fetcher,
    })).rejects.toMatchObject({
      name: 'SsoIdentityAdoptionError',
      reason: 'phone_verification_required',
    })
  })
})
