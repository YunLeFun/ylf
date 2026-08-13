import type { PagesFileDescriptor, PagesScanResult } from './scanner'
import { createRequire } from 'node:module'
import process from 'node:process'
import { createAuthTokenStore, getValidAccessToken } from '../auth'
import { orderPagesUploads } from './scanner'

const require = createRequire(import.meta.url)

interface CosUploadResponse {
  ETag?: string
}

interface CosClient {
  uploadFile: (
    params: Record<string, unknown>,
    callback: (error: Error | null, data: CosUploadResponse) => void,
  ) => void
}

interface CosConstructor {
  new (options: Record<string, unknown>): CosClient
}

interface DeploymentPlanUpload {
  path: string
  key: string
}

interface DeploymentPlanResponse {
  deploymentId: string
  deploymentToken: string
  leaseExpiresAt: number
  targetUrl: string
  bucket: string
  region: string
  prefix: string
  credentials: {
    secretId: string
    secretKey: string
    sessionToken: string
    expiredAt: number
  }
  uploads: DeploymentPlanUpload[]
  deletes: string[]
  unchanged: number
}

export interface PagesDeployResult {
  deploymentId: string
  url: string
  uploaded: number
  deleted: number
  unchanged: number
}

export async function deployPagesScan(input: {
  workspace: string
  project: string
  scan: PagesScanResult
  clean: boolean
  allowLargeDelete: boolean
  allowNoIndex: boolean
  apiBaseUrl?: string
  concurrency?: number
  fetch?: typeof globalThis.fetch
  onProgress?: (message: string) => void
}): Promise<PagesDeployResult> {
  const fetcher = input.fetch ?? globalThis.fetch
  const authorization = await resolveDeploymentAuthorization(fetcher, input.apiBaseUrl)
  const apiBaseUrl = input.apiBaseUrl ?? authorization.apiBaseUrl
  const plan = await requestJson<DeploymentPlanResponse>(fetcher, `${apiBaseUrl}/api/pages/deployments/plan`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${authorization.token}`,
      'content-type': 'application/json',
      'x-ylf-auth-method': authorization.method,
    },
    body: JSON.stringify({
      workspace: input.workspace,
      project: input.project,
      clean: input.clean,
      allowLargeDelete: input.allowLargeDelete,
      allowNoIndex: input.allowNoIndex,
      files: input.scan.files.map(file => ({
        path: file.path,
        size: file.size,
        sha256: file.sha256,
        contentType: file.contentType,
        cacheControl: file.cacheControl,
      })),
    }),
  })
  validateDeploymentPlan(plan, input.project, input.scan)
  const deploymentAuthorization = {
    token: plan.deploymentToken,
    method: 'deployment-token',
  }

  const files = new Map(input.scan.files.map(file => [file.path, file]))
  const plannedFiles = plan.uploads.map((item) => {
    const file = files.get(item.path)
    if (!file)
      throw new Error(`服务端计划包含本地不存在的文件：${item.path}`)
    return { file, key: item.key }
  })
  const COS = require('cos-nodejs-sdk-v5') as CosConstructor
  const cos = new COS({
    SecretId: plan.credentials.secretId,
    SecretKey: plan.credentials.secretKey,
    SecurityToken: plan.credentials.sessionToken,
    FileParallelLimit: normalizeConcurrency(input.concurrency),
    ChunkRetryTimes: 3,
    UserAgent: 'ylf-pages/0.0.1',
  })
  const uploaded: Array<{ path: string, key: string, etag: string }> = []
  let heartbeatFailure: Error | null = null
  const heartbeat = setInterval(() => {
    void sendDeploymentRequest(fetcher, apiBaseUrl, deploymentAuthorization, plan.deploymentId, 'heartbeat', {})
      .catch((error: unknown) => {
        heartbeatFailure = error instanceof Error ? error : new Error(String(error))
      })
  }, 20_000)
  heartbeat.unref()

  try {
    const ordered = orderPagesUploads(plannedFiles.map(item => item.file))
    const plannedMap = new Map(plannedFiles.map(item => [item.file.path, item.key]))
    for (const rank of [0, 1, 2]) {
      const group = ordered.filter(file => uploadRank(file) === rank)
      await mapLimit(group, normalizeConcurrency(input.concurrency), async (file) => {
        if (heartbeatFailure)
          throw heartbeatFailure
        const key = plannedMap.get(file.path)!
        const response = await uploadFile(cos, plan, file, key)
        uploaded.push({ path: file.path, key, etag: normalizeEtag(response.ETag) })
        input.onProgress?.(`uploaded ${file.path}`)
      })
    }
    const finalized = await sendDeploymentRequest<{ url: string }>(
      fetcher,
      apiBaseUrl,
      deploymentAuthorization,
      plan.deploymentId,
      'finalize',
      { objects: uploaded },
    )
    return {
      deploymentId: plan.deploymentId,
      url: typeof finalized.url === 'string' ? finalized.url : plan.targetUrl,
      uploaded: uploaded.length,
      deleted: plan.deletes.length,
      unchanged: plan.unchanged,
    }
  }
  catch (error) {
    await sendDeploymentRequest(
      fetcher,
      apiBaseUrl,
      deploymentAuthorization,
      plan.deploymentId,
      'fail',
      { reason: 'client_upload_failed', objects: uploaded },
    ).catch(() => undefined)
    throw error
  }
  finally {
    clearInterval(heartbeat)
  }
}

async function resolveDeploymentAuthorization(fetcher: typeof globalThis.fetch, apiBaseUrl?: string) {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (requestUrl && requestToken) {
    const url = new URL(requestUrl)
    url.searchParams.set('audience', 'https://admin.yunle.fun/api/pages')
    const response = await requestJson<{ value: string }>(fetcher, url.toString(), {
      headers: { authorization: `Bearer ${requestToken}` },
    })
    if (typeof response.value !== 'string' || !response.value)
      throw new Error('GitHub OIDC 响应缺少 token')
    return {
      token: response.value,
      method: 'github-oidc',
      apiBaseUrl: apiBaseUrl ?? 'https://admin.yunle.fun',
    }
  }
  if (process.env.CI)
    throw new Error('CI 环境未提供 GitHub Actions OIDC；不会启动设备登录')
  const store = await createAuthTokenStore()
  const { accessToken, session } = await getValidAccessToken({ store, fetch: fetcher })
  return {
    token: accessToken,
    method: 'device',
    apiBaseUrl: apiBaseUrl ?? session.apiBaseUrl,
  }
}

async function sendDeploymentRequest<T = Record<string, unknown>>(
  fetcher: typeof globalThis.fetch,
  apiBaseUrl: string,
  authorization: { token: string, method: string },
  deploymentId: string,
  action: 'heartbeat' | 'finalize' | 'fail',
  body: Record<string, unknown>,
): Promise<T> {
  return requestJson<T>(fetcher, `${apiBaseUrl}/api/pages/deployments/${encodeURIComponent(deploymentId)}/${action}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${authorization.token}`,
      'content-type': 'application/json',
      'x-ylf-auth-method': authorization.method,
    },
    body: JSON.stringify(body),
  })
}

function uploadFile(
  cos: CosClient,
  plan: DeploymentPlanResponse,
  file: PagesFileDescriptor,
  key: string,
): Promise<CosUploadResponse> {
  return new Promise((resolve, reject) => {
    cos.uploadFile(
      buildPagesCosUploadParams(plan, file, key),
      (error, data) => error ? reject(error) : resolve(data),
    )
  })
}

export function buildPagesCosUploadParams(
  plan: { bucket: string, region: string },
  file: PagesFileDescriptor,
  key: string,
): Record<string, unknown> {
  return {
    Bucket: plan.bucket,
    Region: plan.region,
    Key: key,
    FilePath: file.absolutePath,
    ContentType: file.contentType,
    CacheControl: file.cacheControl,
    ServerSideEncryption: 'AES256',
    SliceSize: 8 * 1024 * 1024,
  }
}

function validateDeploymentPlan(plan: DeploymentPlanResponse, project: string, scan: PagesScanResult): void {
  if (!plan || typeof plan.deploymentId !== 'string' || typeof plan.deploymentToken !== 'string'
    || !plan.deploymentToken || typeof plan.bucket !== 'string'
    || typeof plan.region !== 'string' || typeof plan.prefix !== 'string'
    || !Array.isArray(plan.uploads) || !Array.isArray(plan.deletes)
    || !plan.credentials || typeof plan.credentials.secretId !== 'string'
    || typeof plan.credentials.secretKey !== 'string' || typeof plan.credentials.sessionToken !== 'string') {
    throw new Error('服务端部署计划格式无效')
  }
  if (plan.prefix !== `${project}/`)
    throw new Error('服务端部署前缀与项目不匹配')
  const localPaths = new Set(scan.files.map(file => file.path))
  const keys = new Set<string>()
  for (const upload of plan.uploads) {
    if (!upload || typeof upload.path !== 'string' || typeof upload.key !== 'string'
      || upload.key !== `${plan.prefix}${upload.path}` || !localPaths.has(upload.path)) {
      throw new Error('服务端部署计划包含越界对象键')
    }
    if (keys.has(upload.key))
      throw new Error('服务端部署计划包含重复对象键')
    keys.add(upload.key)
  }
}

async function requestJson<T>(fetcher: typeof globalThis.fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetcher(url, init)
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok)
    throw new Error(String(data.message || data.statusMessage || data.error_description || `HTTP ${response.status}`))
  return data as T
}

function uploadRank(file: PagesFileDescriptor): number {
  if (file.path === 'index.html')
    return 2
  return /\.html?$/.test(file.path) ? 1 : 0
}

function normalizeEtag(value: string | undefined): string {
  return typeof value === 'string' ? value.replace(/^"|"$/g, '') : ''
}

function normalizeConcurrency(value: number | undefined): number {
  return Math.max(1, Math.min(16, Number.isSafeInteger(value) ? value! : 8))
}

async function mapLimit<T>(items: T[], concurrency: number, mapper: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
}
