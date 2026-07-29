import { generateKeyPairSync } from 'node:crypto'
import { SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import {
  SsoIdentityProofError,
  verifySsoIdentityProof,
} from '../src/server'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const nonce = 'n'.repeat(43)
const userId = 'user-identity-123'
const config = {
  cloudbaseEnvId: 'yunlefun-test',
  appId: 'cms',
  clientId: 'cms-web',
  issuer: 'https://www.yunle.fun',
  jwksUrl: 'https://api.yunle.fun/sso-ticket',
}

async function assertion(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    app_id: config.appId,
    scope: ['identity:bootstrap'],
    nonce,
    phone_number_verified: true,
    account_status: 'active',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'ylf-identity+jwt', kid: 'test-key' })
    .setIssuer(config.issuer)
    .setAudience(config.clientId)
    .setSubject(userId)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 120)
    .setJti('test-assertion')
    .sign(privateKey)
}

describe('verifySsoIdentityProof', () => {
  it('projects a bound, phone-verified, active CloudBase identity', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      sub: userId,
      username: 'yunyou',
      user_metadata: {
        name: 'YunYou',
        avatarUrl: 'https://cdn.yunle.fun/avatar.png',
      },
    }), { status: 200 }))

    await expect(verifySsoIdentityProof({
      accessToken: 'opaque-cloudbase-access-token',
      identityAssertion: await assertion(),
      nonce,
    }, config, {
      fetch: fetcher,
      identityKey: publicKey,
    })).resolves.toEqual({
      userId,
      handle: 'yunyou',
      displayName: 'YunYou',
      avatarUrl: 'https://cdn.yunle.fun/avatar.png',
      phoneVerified: true,
      accountStatus: 'active',
    })
  })

  it('rejects an assertion bound to another nonce', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sub: userId }), {
      status: 200,
    }))
    await expect(verifySsoIdentityProof({
      accessToken: 'opaque-cloudbase-access-token',
      identityAssertion: await assertion({ nonce: 'x'.repeat(43) }),
      nonce,
    }, config, {
      fetch: fetcher,
      identityKey: publicKey,
    })).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_REQUIRED',
    })
  })

  it('rejects unsigned phone metadata when the signed claim is false', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      sub: userId,
      user_metadata: { phone_number_verified: true },
    }), { status: 200 }))
    await expect(verifySsoIdentityProof({
      accessToken: 'opaque-cloudbase-access-token',
      identityAssertion: await assertion({ phone_number_verified: false }),
      nonce,
    }, config, {
      fetch: fetcher,
      identityKey: publicKey,
    })).rejects.toBeInstanceOf(SsoIdentityProofError)
  })

  it('validates proof inputs before contacting CloudBase', async () => {
    const fetcher = vi.fn()
    await expect(verifySsoIdentityProof({
      accessToken: '',
      identityAssertion: '',
      nonce: '',
    }, config, { fetch: fetcher })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
