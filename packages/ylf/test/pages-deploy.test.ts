import { describe, expect, it } from 'vitest'
import { buildPagesCosUploadParams } from '../src/pages/deploy'

describe('pages COS upload', () => {
  it('enforces SSE-COS for every deployed object', () => {
    const params = buildPagesCosUploadParams({
      bucket: 'yunlefun-pages-prod-1325586649',
      region: 'ap-guangzhou',
    }, {
      absolutePath: '/tmp/index.html',
      path: 'index.html',
      size: 1,
      sha256: 'a'.repeat(64),
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'public, max-age=0, must-revalidate',
    }, 'demo/index.html')

    expect(params).toMatchObject({
      Bucket: 'yunlefun-pages-prod-1325586649',
      Region: 'ap-guangzhou',
      Key: 'demo/index.html',
      ServerSideEncryption: 'AES256',
    })
  })
})
