import { describe, expect, it } from 'vitest'
import {
  ACQUISITION_MAX_BYTES,
  decodeAcquisitionContext,
  encodeAcquisitionContext,
  readAcquisitionContext,
  sanitizeAcquisitionContext,
} from '../src/acquisition'
import { buildSsoRequestUrl } from '../src/protocol'
import { acquisition } from './acquisition-fixture'

const request = {
  ssoOrigin: 'https://www.yunle.fun',
  clientId: 'cook-web',
  scope: ['identity:bootstrap'],
  redirectUri: 'https://cook.yunle.fun/auth/callback',
  nonce: 'n'.repeat(43),
  codeChallenge: 'c'.repeat(43),
}

describe('optional acquisition context', () => {
  it('round trips UTF-8 JSON through URLSearchParams exactly once', () => {
    const url = new URL(buildSsoRequestUrl({ ...request, acquisition }))
    const encoded = url.searchParams.get('acquisition')
    expect(encoded).toBe(encodeAcquisitionContext(acquisition))
    expect(decodeAcquisitionContext(encoded)).toEqual(acquisition)
    expect(readAcquisitionContext(acquisition)).toEqual(acquisition)
    expect(readAcquisitionContext(encoded)).toEqual(acquisition)
    expect(decodeAcquisitionContext(encodeURIComponent(encoded!))).toBeNull()
  })

  it('removes query/hash and unknown fields rather than carrying credentials', () => {
    const input = {
      ...acquisition,
      access_token: 'private',
      firstTouch: { ...acquisition.firstTouch, landingPath: '/random?token=private#code', ticket: 'private' },
    }
    const sanitized = sanitizeAcquisitionContext(input)
    expect(sanitized?.firstTouch.landingPath).toBe('/random')
    expect(encodeAcquisitionContext(input)).not.toContain('private')
    expect(sanitized).not.toHaveProperty('access_token')
  })

  it.each([
    null,
    { ...acquisition, version: 2 },
    { ...acquisition, firstTouch: null },
    { ...acquisition, firstTouch: { ...acquisition.firstTouch, capturedAt: 0 } },
    { ...acquisition, firstTouch: { ...acquisition.firstTouch, landingHost: 'user:pass@example.com' } },
    { ...acquisition, firstTouch: { ...acquisition.firstTouch, landingPath: '//user:pass@example.com' } },
    { ...acquisition, firstTouch: { ...acquisition.firstTouch, landingPath: '/x%0Atoken' } },
    { ...acquisition, firstTouch: { ...acquisition.firstTouch, referrerHost: 'example.com/path?q=secret' } },
    { ...acquisition, firstTouch: { ...acquisition.firstTouch, utmSource: 'x\nsecret' } },
    { ...acquisition, firstTouch: { ...acquisition.firstTouch, utmCampaign: 'x'.repeat(121) } },
  ])('omits malformed context without rejecting a valid PKCE authorization', (input) => {
    expect(sanitizeAcquisitionContext(input)).toBeNull()
    const url = new URL(buildSsoRequestUrl({ ...request, acquisition: input as never }))
    expect(url.searchParams.has('acquisition')).toBe(false)
    expect(url.searchParams.get('nonce')).toBe(request.nonce)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('rejects malformed or oversized serialized data before parsing', () => {
    for (const value of ['not JSON', '[]', 'x'.repeat(ACQUISITION_MAX_BYTES + 1)])
      expect(decodeAcquisitionContext(value)).toBeNull()
  })

  it('enforces the total UTF-8 budget even when individual fields fit their limits', () => {
    const host = [63, 63, 63, 61].map(length => 'a'.repeat(length)).join('.')
    const touch = {
      ...acquisition.firstTouch,
      landingHost: host,
      referrerHost: host,
      landingPath: `/${'菜'.repeat(255)}`,
      utmSource: '菜'.repeat(120),
      utmMedium: '菜'.repeat(120),
      utmCampaign: '菜'.repeat(120),
    }
    expect(sanitizeAcquisitionContext({ version: 1, firstTouch: touch, registerTouch: touch })).toBeNull()
  })
})
