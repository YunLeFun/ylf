import { describe, expect, it } from 'vitest'
import {
  buildSsoRequestUrl,
  firstQueryValue,
  isAnonymousSession,
  parseSsoResultMessage,
  readSsoMode,
  readSsoNonce,
  readSsoTargetOrigin,
  SSO_RESULT_TYPE,
} from '../src/protocol'

const ORIGIN = 'https://www.yunle.fun'
const NONCE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

describe('firstQueryValue', () => {
  it('normalizes string / array / missing', () => {
    expect(firstQueryValue('abc')).toBe('abc')
    expect(firstQueryValue(['first', 'second'])).toBe('first')
    expect(firstQueryValue(undefined)).toBe('')
    expect(firstQueryValue([])).toBe('')
  })
})

describe('provider-side request parsing', () => {
  it('readSsoMode only returns interactive for the exact value', () => {
    expect(readSsoMode('interactive')).toBe('interactive')
    expect(readSsoMode(['interactive'])).toBe('interactive')
    expect(readSsoMode('silent')).toBe('silent')
    expect(readSsoMode(undefined)).toBe('silent')
  })

  it('readSsoTargetOrigin normalizes origin and rejects junk', () => {
    expect(readSsoTargetOrigin('https://apps.yunle.fun/x?y=1')).toBe('https://apps.yunle.fun')
    expect(readSsoTargetOrigin('http://localhost:2333')).toBe('http://localhost:2333')
    expect(readSsoTargetOrigin('not-a-url')).toBe('')
    expect(readSsoTargetOrigin(undefined)).toBe('')
  })

  it('readSsoNonce trims', () => {
    expect(readSsoNonce('  abc  ')).toBe('abc')
    expect(readSsoNonce(undefined)).toBe('')
  })

  it('isAnonymousSession only flags anonymous users', () => {
    expect(isAnonymousSession({ user: { is_anonymous: true } })).toBe(true)
    expect(isAnonymousSession({ user: { is_anonymous: false } })).toBe(false)
    expect(isAnonymousSession({ user: {} })).toBe(false)
    expect(isAnonymousSession(null)).toBe(false)
    expect(isAnonymousSession('nope')).toBe(false)
  })
})

describe('buildSsoRequestUrl', () => {
  it('builds an encoded bridge URL and strips trailing slash', () => {
    const url = buildSsoRequestUrl({
      ssoOrigin: 'https://www.yunle.fun/',
      mode: 'silent',
      targetOrigin: 'https://apps.yunle.fun',
      nonce: NONCE,
    })
    const parsed = new URL(url)
    expect(parsed.origin).toBe(ORIGIN)
    expect(parsed.pathname).toBe('/auth/sso')
    expect(parsed.searchParams.get('mode')).toBe('silent')
    expect(parsed.searchParams.get('targetOrigin')).toBe('https://apps.yunle.fun')
    expect(parsed.searchParams.get('nonce')).toBe(NONCE)
  })
})

describe('parseSsoResultMessage', () => {
  function msg(extra: Record<string, unknown> = {}) {
    return { type: SSO_RESULT_TYPE, nonce: NONCE, ...extra }
  }

  it('accepts a valid success message', () => {
    const session = { access_token: 'at', refresh_token: 'rt' }
    expect(parseSsoResultMessage({
      expectedOrigin: ORIGIN,
      expectedNonce: NONCE,
      eventOrigin: ORIGIN,
      data: msg({ ok: true, session }),
    })).toEqual({ ok: true, session })
  })

  it('maps failure reasons', () => {
    expect(parseSsoResultMessage({
      expectedOrigin: ORIGIN,
      expectedNonce: NONCE,
      eventOrigin: ORIGIN,
      data: msg({ ok: false, reason: 'invalid_request' }),
    })).toEqual({ ok: false, reason: 'invalid_request' })
  })

  it('ignores wrong origin, wrong nonce, wrong type and non-objects', () => {
    const session = { access_token: 'at', refresh_token: 'rt' }
    expect(parseSsoResultMessage({ expectedOrigin: ORIGIN, expectedNonce: NONCE, eventOrigin: 'https://evil.example.com', data: msg({ ok: true, session }) })).toBeNull()
    expect(parseSsoResultMessage({ expectedOrigin: ORIGIN, expectedNonce: NONCE, eventOrigin: ORIGIN, data: msg({ nonce: 'other', ok: true, session }) })).toBeNull()
    expect(parseSsoResultMessage({ expectedOrigin: ORIGIN, expectedNonce: NONCE, eventOrigin: ORIGIN, data: { type: 'nope', nonce: NONCE } })).toBeNull()
    expect(parseSsoResultMessage({ expectedOrigin: ORIGIN, expectedNonce: NONCE, eventOrigin: ORIGIN, data: 'str' })).toBeNull()
  })

  it('treats ok:true without a session as a failure', () => {
    expect(parseSsoResultMessage({
      expectedOrigin: ORIGIN,
      expectedNonce: NONCE,
      eventOrigin: ORIGIN,
      data: msg({ ok: true }),
    })).toEqual({ ok: false, reason: 'not_authenticated' })
  })
})
