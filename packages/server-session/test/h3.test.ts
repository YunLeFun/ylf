import type { IncomingHttpHeaders } from 'node:http'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'
import { createOpaqueToken, deriveSessionCsrfToken, SessionError } from '../src'
import { assertRequestOrigin, assertSessionCsrf, clearSessionCookie, writeSessionCookie } from '../src/h3'

function createNodeEvent(headers: IncomingHttpHeaders = {}) {
  const request = new IncomingMessage(new Socket())
  request.headers = headers
  const response = new ServerResponse(request)
  return { event: createEvent(request, response), response }
}

describe('h3 session security helpers', () => {
  it('writes and clears only a secure __Host- cookie', () => {
    const { event, response } = createNodeEvent()
    const token = createOpaqueToken(new Uint8Array(32).fill(1))
    writeSessionCookie(event, { name: '__Host-ylf-drive-session' }, token, 3600)
    const written = response.getHeader('set-cookie')
    expect(String(written)).toContain('__Host-ylf-drive-session=')
    expect(String(written)).toContain('HttpOnly')
    expect(String(written)).toContain('Secure')
    expect(String(written)).toContain('Path=/')
    expect(String(written)).toContain('SameSite=Lax')
    expect(String(written)).not.toContain('Domain=')

    clearSessionCookie(event, { name: '__Host-ylf-drive-session' })
    expect(String(response.getHeader('set-cookie'))).toContain('Max-Age=0')
  })

  it('requires an exact HTTPS Origin with an explicit localhost exception', () => {
    const { event: allowed } = createNodeEvent({ origin: 'https://drive.yunle.fun' })
    expect(assertRequestOrigin(allowed, { allowedOrigins: ['https://drive.yunle.fun'] })).toBe('https://drive.yunle.fun')

    const { event: rejected } = createNodeEvent({ origin: 'https://evil.example' })
    expect(() => assertRequestOrigin(rejected, { allowedOrigins: ['https://drive.yunle.fun'] })).toThrow(SessionError)

    const { event: crossSite } = createNodeEvent({ 'origin': 'https://drive.yunle.fun', 'sec-fetch-site': 'cross-site' })
    expect(() => assertRequestOrigin(crossSite, { allowedOrigins: ['https://drive.yunle.fun'] })).toThrow(SessionError)

    const { event: local } = createNodeEvent({ origin: 'http://localhost:3000' })
    expect(assertRequestOrigin(local, { allowedOrigins: ['http://localhost:3000'], allowHttpLocalhost: true })).toBe('http://localhost:3000')
  })

  it('verifies a session-bound CSRF value', () => {
    const token = createOpaqueToken(new Uint8Array(32).fill(1))
    const secret = 's'.repeat(32)
    const csrfToken = deriveSessionCsrfToken(token, secret, 'drive')
    expect(() => assertSessionCsrf({ sessionToken: token, csrfToken, platformSecret: secret, scope: 'drive' })).not.toThrow()
    expect(() => assertSessionCsrf({ sessionToken: token, csrfToken: 'bad', platformSecret: secret, scope: 'drive' })).toThrow(SessionError)
  })
})
