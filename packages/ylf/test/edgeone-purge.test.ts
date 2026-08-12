import type { CreatePurgeTaskRequest, CreatePurgeTaskResponse } from 'tencentcloud-sdk-nodejs/tencentcloud/services/teo/v20220901/teo_models'
import { describe, expect, it, vi } from 'vitest'
import { createTencentClientConfig } from '../src/cli/tencent/config'
import {
  buildEdgeOnePurgeRequest,
  submitEdgeOnePurgeTask,
} from '../src/cli/tencent/teo-purge'

describe('edgeOne purge request', () => {
  it('builds a deterministic Hostname purge request for CI scripts', () => {
    expect(buildEdgeOnePurgeRequest({
      zoneId: ' zone-abc123 ',
      type: 'purge_host',
      targets: ['CDN.example.com', ' cdn.example.com ', 'static.example.com'],
    })).toEqual({
      ZoneId: 'zone-abc123',
      Type: 'purge_host',
      Targets: ['cdn.example.com', 'static.example.com'],
    })
  })

  it('requires URL and directory targets to include HTTP(S) protocol', () => {
    expect(buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_url',
      targets: ['https://cdn.example.com/app.js'],
    }).Targets).toEqual(['https://cdn.example.com/app.js'])
    expect(buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_prefix',
      targets: ['https://cdn.example.com/assets/'],
      method: 'delete',
    })).toEqual({
      ZoneId: 'zone-abc123',
      Type: 'purge_prefix',
      Method: 'delete',
      Targets: ['https://cdn.example.com/assets/'],
    })
    expect(() => buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_url',
      targets: ['cdn.example.com/app.js'],
    })).toThrow(/HTTP\(S\)/)
    expect(() => buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_prefix',
      targets: ['ftp://cdn.example.com/assets/'],
    })).toThrow(/HTTP\(S\)/)
  })

  it('rejects wildcard or URL-shaped Hostname targets', () => {
    for (const target of ['*.example.com', 'https://cdn.example.com', 'cdn.example.com/path']) {
      expect(() => buildEdgeOnePurgeRequest({
        zoneId: 'zone-abc123',
        type: 'purge_host',
        targets: [target],
      })).toThrow(/Hostname/)
    }
  })

  it('requires an exact zone confirmation for a site-wide purge', () => {
    expect(() => buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_all',
    })).toThrow(/confirmAll.*zone-abc123/)
    expect(() => buildEdgeOnePurgeRequest({
      zoneId: '*',
      type: 'purge_all',
      confirmAll: '*',
    })).toThrow(/通配/)
    expect(() => buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_all',
      targets: [],
      confirmAll: 'zone-abc123',
    })).toThrow(/不接受 targets/)
    expect(buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_all',
      confirmAll: 'zone-abc123',
    })).toEqual({
      ZoneId: 'zone-abc123',
      Type: 'purge_all',
    })
  })

  it('requires cache tags and their affected domains together', () => {
    expect(buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_cache_tag',
      targets: ['release-42', 'release-42'],
      cacheTagDomains: ['www.example.com'],
    })).toEqual({
      ZoneId: 'zone-abc123',
      Type: 'purge_cache_tag',
      Targets: ['release-42'],
      CacheTag: { Domains: ['www.example.com'] },
    })
    expect(() => buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_cache_tag',
      targets: ['release-42'],
    })).toThrow(/cacheTagDomains/)
  })

  it('rejects missing targets and options that the selected purge type ignores', () => {
    expect(() => buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_host',
      targets: [],
    })).toThrow(/targets/)
    expect(() => buildEdgeOnePurgeRequest({
      zoneId: 'zone-abc123',
      type: 'purge_url',
      targets: ['https://cdn.example.com/app.js'],
      method: 'invalidate',
    })).toThrow(/method/)
  })
})

describe('edgeOne purge submission', () => {
  it('returns stable job metadata after submitting the validated request', async () => {
    const request: CreatePurgeTaskRequest = {
      ZoneId: 'zone-abc123',
      Type: 'purge_host',
      Targets: ['cdn.example.com'],
    }
    const createPurgeTask = vi.fn(async (): Promise<CreatePurgeTaskResponse> => ({
      JobId: 'job-42',
      FailedList: [],
      RequestId: 'request-42',
    }))

    await expect(submitEdgeOnePurgeTask(request, { CreatePurgeTask: createPurgeTask })).resolves.toEqual({
      jobId: 'job-42',
      requestId: 'request-42',
    })
    expect(createPurgeTask).toHaveBeenCalledOnce()
    expect(createPurgeTask).toHaveBeenCalledWith(request)
  })

  it('fails on partial rejection or a response without a job id', async () => {
    const request: CreatePurgeTaskRequest = {
      ZoneId: 'zone-abc123',
      Type: 'purge_host',
      Targets: ['cdn.example.com'],
    }
    await expect(submitEdgeOnePurgeTask(request, {
      CreatePurgeTask: async () => ({
        JobId: 'job-42',
        RequestId: 'request-42',
        FailedList: [{ Reason: 'invalid target', Targets: ['cdn.example.com'] }],
      }),
    })).rejects.toThrow(/cdn\.example\.com.*invalid target/)
    await expect(submitEdgeOnePurgeTask(request, {
      CreatePurgeTask: async () => ({ RequestId: 'request-42' }),
    })).rejects.toThrow(/JobId/)
  })
})

describe('tencent Cloud credentials', () => {
  it('fails closed before network access when either credential is missing', () => {
    expect(() => createTencentClientConfig({
      TENCENT_CLOUD_SECRET_ID: 'secret-id',
    })).toThrow(/TENCENT_CLOUD_SECRET_KEY/)
    expect(() => createTencentClientConfig({
      TENCENT_CLOUD_SECRET_KEY: 'secret-key',
    })).toThrow(/TENCENT_CLOUD_SECRET_ID/)
  })

  it('creates a client config without exposing credentials elsewhere', () => {
    expect(createTencentClientConfig({
      TENCENT_CLOUD_SECRET_ID: 'secret-id',
      TENCENT_CLOUD_SECRET_KEY: 'secret-key',
    })).toEqual({
      region: 'ap-shanghai',
      credential: {
        secretId: 'secret-id',
        secretKey: 'secret-key',
      },
    })
  })
})
