import { describe, expect, it } from 'vitest'

import {
  buildSupportUrl,
  MAX_SUPPORT_URL_LENGTH,
  parseSupportUrl,
  SUPPORT_PROTOCOL_VERSION,
  SupportClientError,
} from '../src'

describe('support URL protocol', () => {
  it('builds and parses a versioned product context URL', () => {
    const url = buildSupportUrl({
      context: {
        errorCode: 'DRIVE_UPLOAD_FAILED',
        pageUrl: 'https://drive.yunle.fun/assets?tab=recent#asset-1',
        requestId: 'req_20260720_0001',
        version: '1.4.0',
      },
      intent: 'ticket',
      product: 'drive',
      source: 'drive-web',
    })

    expect(new URL(url).pathname).toBe('/tickets/new')
    expect(parseSupportUrl(url)).toEqual({
      context: {
        errorCode: 'DRIVE_UPLOAD_FAILED',
        pageUrl: 'https://drive.yunle.fun/assets',
        requestId: 'req_20260720_0001',
        version: '1.4.0',
      },
      intent: 'ticket',
      product: 'drive',
      protocolVersion: SUPPORT_PROTOCOL_VERSION,
      source: 'drive-web',
    })
  })

  it('accepts the R1 type name and legacy links without a version', () => {
    const current = buildSupportUrl({
      product: 'cms',
      type: 'feedback',
    })
    const legacy = 'https://support.yunle.fun/feedback/new?product=cms&type=feedback'

    expect(parseSupportUrl(current).intent).toBe('feedback')
    expect(parseSupportUrl(legacy)).toMatchObject({
      intent: 'feedback',
      product: 'cms',
      protocolVersion: '1',
    })
  })

  it('rejects unknown products, intents, and future protocol versions', () => {
    expect(() => buildSupportUrl({
      intent: 'ticket',
      product: 'unknown',
    })).toThrowError(SupportClientError)
    expect(() => buildSupportUrl({
      intent: 'chat',
      product: 'drive',
    })).toThrowError(SupportClientError)
    expect(() => parseSupportUrl(
      'https://support.yunle.fun/help?v=2&product=drive&type=help',
    )).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PROTOCOL' }))
  })

  it('drops sensitive and unknown context without preserving query secrets', () => {
    const url = buildSupportUrl({
      authorization: 'Bearer root-secret',
      context: {
        cookie: 'session=root-secret',
        fullLog: 'root-secret',
        pageUrl: 'https://drive.yunle.fun/assets?access_token=root-secret#debug',
        requestId: 'req_safe_0001',
        token: 'root-secret',
      },
      intent: 'security',
      product: 'drive',
    })

    expect(url).not.toContain('root-secret')
    expect(url).not.toContain('access_token')
    expect(parseSupportUrl(url).context).toEqual({
      errorCode: undefined,
      pageUrl: 'https://drive.yunle.fun/assets',
      requestId: 'req_safe_0001',
      version: undefined,
    })
  })

  it('rejects malicious origins and omits unsafe page URLs', () => {
    expect(() => buildSupportUrl({
      intent: 'help',
      product: 'www',
    }, {
      origin: 'javascript:alert(1)',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_ORIGIN' }))

    const url = buildSupportUrl({
      context: {
        pageUrl: 'javascript:alert(1)',
      },
      intent: 'help',
      product: 'www',
    })
    expect(new URL(url).searchParams.has('page')).toBe(false)
  })

  it('omits oversized optional values and never exceeds the URL budget', () => {
    const url = buildSupportUrl({
      context: {
        errorCode: `ERROR_${'x'.repeat(200)}`,
        pageUrl: `https://drive.yunle.fun/${'a'.repeat(5_000)}`,
        requestId: `req_${'x'.repeat(200)}`,
        version: `v${'1'.repeat(100)}`,
      },
      intent: 'ticket',
      product: 'drive',
      source: `source-${'x'.repeat(100)}`,
    })

    expect(url.length).toBeLessThanOrEqual(MAX_SUPPORT_URL_LENGTH)
    expect(parseSupportUrl(url)).toEqual({
      context: {
        errorCode: undefined,
        pageUrl: undefined,
        requestId: undefined,
        version: undefined,
      },
      intent: 'ticket',
      product: 'drive',
      protocolVersion: '1',
      source: undefined,
    })
  })
})
