import { describe, expect, it } from 'vitest'
import {
  buildSsoRequestUrl,
  deriveSsoPkceChallenge,
  encodeSsoRedirectResult,
  firstQueryValue,
  isAnonymousSession,
  parseSsoRedirectResult,
  readSsoClientId,
  readSsoCodeChallenge,
  readSsoCodeChallengeMethod,
  readSsoNonce,
  readSsoPrompt,
  readSsoRedirectUri,
  readSsoScope,
  SSO_REDIRECT_HASH_KEY,
} from '../src/protocol'

const ISSUER = 'https://www.yunle.fun'
const NONCE = 'n'.repeat(43)
const CHALLENGE = 'c'.repeat(43)

describe('sso v3 request protocol', () => {
  it('parses only explicit client, scope, redirect URI, nonce, and S256 PKCE values', async () => {
    expect(firstQueryValue(['first', 'second'])).toBe('first')
    expect(readSsoClientId('cms-web')).toBe('cms-web')
    expect(readSsoClientId('CMS Web')).toBe('')
    expect(readSsoScope('identity:bootstrap')).toEqual(['identity:bootstrap'])
    expect(readSsoScope('identity:bootstrap identity:bootstrap')).toEqual([])
    expect(readSsoScope(undefined)).toEqual([])
    expect(readSsoRedirectUri('https://cms.yunle.fun/')).toBe('https://cms.yunle.fun/')
    expect(readSsoRedirectUri('https://cms.yunle.fun/#fragment')).toBe('')
    expect(readSsoRedirectUri('http://localhost:3000/')).toBe('')
    expect(readSsoNonce(NONCE)).toBe(NONCE)
    expect(readSsoCodeChallenge(CHALLENGE)).toBe(CHALLENGE)
    expect(readSsoCodeChallengeMethod('S256')).toBe('S256')
    expect(readSsoCodeChallengeMethod('plain')).toBe('')
    expect(await deriveSsoPkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('builds only the redirect + PKCE request surface with OAuth-style names', () => {
    const url = new URL(buildSsoRequestUrl({
      ssoOrigin: ISSUER,
      clientId: 'cms-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://cms.yunle.fun/',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
    }))

    expect(`${url.origin}${url.pathname}`).toBe('https://www.yunle.fun/auth/sso')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cms-web',
      redirect_uri: 'https://cms.yunle.fun/',
      scope: 'identity:bootstrap',
      nonce: NONCE,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
    })
    expect(url.searchParams.has('mode')).toBe(false)
    expect(url.searchParams.has('targetOrigin')).toBe(false)
  })

  it('carries only the supported standard interaction hints', () => {
    expect(readSsoPrompt('select_account')).toBe('select_account')
    expect(readSsoPrompt('consent')).toBe('consent')
    expect(readSsoPrompt('login')).toBe('')
    expect(readSsoPrompt(['select_account', 'login'])).toBe('select_account')

    const url = new URL(buildSsoRequestUrl({
      ssoOrigin: ISSUER,
      clientId: 'cms-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://cms.yunle.fun/',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      prompt: 'select_account',
    }))

    expect(url.searchParams.get('prompt')).toBe('select_account')
  })

  it('rejects omitted scope and insecure or malformed requests', () => {
    const base = {
      ssoOrigin: ISSUER,
      clientId: 'cms-web',
      scope: ['identity:bootstrap'],
      redirectUri: 'https://cms.yunle.fun/',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
    }
    for (const invalid of [
      { ...base, clientId: '' },
      { ...base, scope: [] },
      { ...base, redirectUri: 'javascript:alert(1)' },
      { ...base, ssoOrigin: 'http://localhost:3000' },
    ]) {
      expect(() => buildSsoRequestUrl(invalid)).toThrow(TypeError)
    }
  })

  it('keeps anonymous-session detection as the provider auth seam', () => {
    expect(isAnonymousSession({ user: { is_anonymous: true } })).toBe(true)
    expect(isAnonymousSession({ user: { is_anonymous: false } })).toBe(false)
  })
})

describe('sso v3 redirect response', () => {
  const hashFor = (value: string) => `#${SSO_REDIRECT_HASH_KEY}=${value}`

  it('round-trips a code only when nonce and issuer both match', () => {
    const encoded = encodeSsoRedirectResult({
      nonce: NONCE,
      issuer: ISSUER,
      ok: true,
      code: 'c'.repeat(43),
    })
    expect(parseSsoRedirectResult({
      hash: hashFor(encoded),
      expectedNonce: NONCE,
      expectedIssuer: ISSUER,
    })).toEqual({
      ok: true,
      code: 'c'.repeat(43),
      nonce: NONCE,
      issuer: ISSUER,
    })
    expect(parseSsoRedirectResult({
      hash: hashFor(encoded),
      expectedNonce: NONCE,
      expectedIssuer: 'https://evil.example',
    })).toBeNull()
  })

  it('rejects responses without issuer and legacy ticket/session payloads', () => {
    const withoutIssuer = encodeSsoRedirectResult({
      nonce: NONCE,
      issuer: '',
      ok: true,
      code: 'c'.repeat(43),
    })
    const legacy = btoa(JSON.stringify({
      nonce: NONCE,
      iss: ISSUER,
      ok: true,
      ticket: 'legacy-ticket',
    }))
    expect(parseSsoRedirectResult({
      hash: hashFor(withoutIssuer),
      expectedNonce: NONCE,
      expectedIssuer: ISSUER,
    })).toBeNull()
    expect(parseSsoRedirectResult({
      hash: hashFor(legacy),
      expectedNonce: NONCE,
      expectedIssuer: ISSUER,
    })).toEqual({ ok: false, reason: 'invalid_request' })
  })
})
