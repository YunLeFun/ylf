import { describe, expect, it } from 'vitest'
import {
  buildSsoRequestUrl,
  encodeSsoRedirectResult,
  firstQueryValue,
  isAnonymousSession,
  isSsoRedirectBoundToTarget,
  parseSsoRedirectResult,
  parseSsoResultMessage,
  readSsoMode,
  readSsoNonce,
  readSsoReturnUrl,
  readSsoTargetOrigin,
  SSO_REDIRECT_HASH_KEY,
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
    expect(readSsoTargetOrigin('http://localhost:2333')).toBe('')
    expect(readSsoTargetOrigin('http://localhost:2333', { allowHttpLocalhost: true })).toBe('http://localhost:2333')
    expect(readSsoTargetOrigin('http://drive.yunle.fun')).toBe('')
    expect(readSsoTargetOrigin('not-a-url')).toBe('')
    expect(readSsoTargetOrigin(undefined)).toBe('')
  })

  it('readSsoNonce trims', () => {
    expect(readSsoNonce(`  ${NONCE}  `)).toBe(NONCE)
    expect(readSsoNonce('too-short')).toBe('')
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

  it('passes a custom-login ticket through alongside the session', () => {
    const session = { access_token: 'at', refresh_token: 'rt' }
    expect(parseSsoResultMessage({
      expectedOrigin: ORIGIN,
      expectedNonce: NONCE,
      eventOrigin: ORIGIN,
      data: msg({ ok: true, session, ticket: 'tkt-123' }),
    })).toEqual({ ok: true, session, ticket: 'tkt-123' })
  })

  it('omits a missing / empty / non-string ticket (stays backward compatible)', () => {
    const session = { access_token: 'at', refresh_token: 'rt' }
    for (const ticket of [undefined, '', 0, false, {}]) {
      expect(parseSsoResultMessage({
        expectedOrigin: ORIGIN,
        expectedNonce: NONCE,
        eventOrigin: ORIGIN,
        data: msg({ ok: true, session, ticket }),
      })).toEqual({ ok: true, session })
    }
  })
})

describe('readSsoMode (redirect)', () => {
  it('returns redirect only for the exact value', () => {
    expect(readSsoMode('redirect')).toBe('redirect')
    expect(readSsoMode(['redirect'])).toBe('redirect')
    expect(readSsoMode('Redirect')).toBe('silent')
    expect(readSsoMode('interactive')).toBe('interactive')
  })
})

describe('readSsoReturnUrl', () => {
  it('accepts http(s) absolute URLs, rejects junk and non-http schemes', () => {
    expect(readSsoReturnUrl('https://wenta.example/path?x=1')).toBe('https://wenta.example/path?x=1')
    expect(readSsoReturnUrl('http://localhost:5173/')).toBe('')
    expect(readSsoReturnUrl('http://localhost:5173/', { allowHttpLocalhost: true })).toBe('http://localhost:5173/')
    expect(readSsoReturnUrl('javascript:alert(1)')).toBe('')
    expect(readSsoReturnUrl('not-a-url')).toBe('')
    expect(readSsoReturnUrl(undefined)).toBe('')
  })

  it('binds the redirect return URL to the declared target origin', () => {
    expect(isSsoRedirectBoundToTarget('https://wenta.example', 'https://wenta.example/deck')).toBe(true)
    expect(isSsoRedirectBoundToTarget('https://wenta.example', 'https://evil.example/deck')).toBe(false)
  })
})

describe('buildSsoRequestUrl (redirect)', () => {
  it('includes returnUrl only when provided', () => {
    const base = buildSsoRequestUrl({ ssoOrigin: ORIGIN, mode: 'interactive', targetOrigin: 'https://wenta.example', nonce: NONCE })
    expect(base).not.toContain('returnUrl')

    const url = new URL(buildSsoRequestUrl({
      ssoOrigin: ORIGIN,
      mode: 'redirect',
      targetOrigin: 'https://wenta.example',
      nonce: NONCE,
      returnUrl: 'https://wenta.example/deck?x=1',
    }))
    expect(url.searchParams.get('mode')).toBe('redirect')
    expect(url.searchParams.get('returnUrl')).toBe('https://wenta.example/deck?x=1')
  })
})

describe('redirect result encode/parse', () => {
  const hashFor = (value: string) => `#${SSO_REDIRECT_HASH_KEY}=${value}`

  it('round-trips a success result carrying the one-time ticket', () => {
    const enc = encodeSsoRedirectResult({ nonce: NONCE, ok: true, ticket: 'tkt-xyz' })
    expect(parseSsoRedirectResult({ hash: hashFor(enc), expectedNonce: NONCE })).toEqual({ ok: true, ticket: 'tkt-xyz' })
  })

  it('prefers a bound v2 authorization code and never carries a refresh token', () => {
    const code = 'c'.repeat(43)
    const enc = encodeSsoRedirectResult({ nonce: NONCE, ok: true, code })
    const decoded = parseSsoRedirectResult({ hash: hashFor(enc), expectedNonce: NONCE })
    expect(decoded).toEqual({ ok: true, code, nonce: NONCE })
    expect(JSON.stringify(decoded)).not.toContain('refresh_token')
  })

  it('round-trips a failure result with its reason', () => {
    const enc = encodeSsoRedirectResult({ nonce: NONCE, ok: false, reason: 'not_configured' })
    expect(parseSsoRedirectResult({ hash: hashFor(enc), expectedNonce: NONCE })).toEqual({ ok: false, reason: 'not_configured' })
  })

  it('rejects a nonce mismatch (CSRF / result-injection guard)', () => {
    const enc = encodeSsoRedirectResult({ nonce: NONCE, ok: true, ticket: 'tkt-xyz' })
    expect(parseSsoRedirectResult({ hash: hashFor(enc), expectedNonce: 'other-nonce' })).toBeNull()
  })

  it('returns null with no result in the hash, or an empty expected nonce', () => {
    const enc = encodeSsoRedirectResult({ nonce: NONCE, ok: true, ticket: 'tkt-xyz' })
    expect(parseSsoRedirectResult({ hash: '#room=abc', expectedNonce: NONCE })).toBeNull()
    expect(parseSsoRedirectResult({ hash: '', expectedNonce: NONCE })).toBeNull()
    expect(parseSsoRedirectResult({ hash: hashFor(enc), expectedNonce: '' })).toBeNull()
  })

  it('treats ok:true without a usable ticket as a failure, and ignores malformed payloads', () => {
    const noTicket = encodeSsoRedirectResult({ nonce: NONCE, ok: true })
    expect(parseSsoRedirectResult({ hash: hashFor(noTicket), expectedNonce: NONCE })).toEqual({ ok: false, reason: 'not_authenticated' })
    expect(parseSsoRedirectResult({ hash: hashFor('!!!not-base64!!!'), expectedNonce: NONCE })).toBeNull()
  })
})
