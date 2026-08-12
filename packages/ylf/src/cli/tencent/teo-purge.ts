import type {
  CreatePurgeTaskRequest,
  CreatePurgeTaskResponse,
} from 'tencentcloud-sdk-nodejs/tencentcloud/services/teo/v20220901/teo_models'

export const EDGEONE_PURGE_TYPES = [
  'purge_url',
  'purge_prefix',
  'purge_host',
  'purge_all',
  'purge_cache_tag',
] as const

export const EDGEONE_PURGE_METHODS = ['invalidate', 'delete'] as const

export type EdgeOnePurgeType = typeof EDGEONE_PURGE_TYPES[number]
export type EdgeOnePurgeMethod = typeof EDGEONE_PURGE_METHODS[number]

export interface EdgeOnePurgeRequestInput {
  zoneId?: unknown
  type?: unknown
  method?: unknown
  targets?: unknown
  cacheTagDomains?: unknown
  confirmAll?: unknown
}

export interface EdgeOnePurgeClient {
  CreatePurgeTask: (request: CreatePurgeTaskRequest) => Promise<CreatePurgeTaskResponse>
}

export interface EdgeOnePurgeSubmission {
  jobId: string
  requestId?: string
}

export class EdgeOnePurgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EdgeOnePurgeError'
  }
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim())
    throw new EdgeOnePurgeError(`${field} 不能为空`)
  return value.trim()
}

function parseStringArray(value: unknown, field: string) {
  if (!Array.isArray(value))
    throw new EdgeOnePurgeError(`${field} 必须是字符串数组`)
  const values = value.map(item => requireString(item, field))
  return [...new Set(values)]
}

function isHostname(value: string) {
  return /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(value)
}

function requireHostname(value: string, field: string) {
  if (!isHostname(value))
    throw new EdgeOnePurgeError(`${field} 必须是明确的 Hostname，不能包含协议、路径或通配符：${value}`)
  return value.toLowerCase()
}

function requireHttpUrl(value: string, field: string) {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname)
      throw new Error('invalid protocol')
    return url.toString()
  }
  catch {
    throw new EdgeOnePurgeError(`${field} 必须是包含 HTTP(S) 协议的完整 URL：${value}`)
  }
}

function parsePurgeType(value: unknown): EdgeOnePurgeType {
  const type = requireString(value, 'type')
  if (!EDGEONE_PURGE_TYPES.includes(type as EdgeOnePurgeType))
    throw new EdgeOnePurgeError(`不支持的 EdgeOne 刷新类型：${type}`)
  return type as EdgeOnePurgeType
}

function parsePurgeMethod(value: unknown, type: EdgeOnePurgeType) {
  if (value === undefined)
    return undefined
  const method = requireString(value, 'method')
  if (!EDGEONE_PURGE_METHODS.includes(method as EdgeOnePurgeMethod))
    throw new EdgeOnePurgeError(`不支持的 EdgeOne 刷新方法：${method}`)
  if (type === 'purge_url' || type === 'purge_cache_tag')
    throw new EdgeOnePurgeError(`${type} 不支持 method 参数`)
  return method as EdgeOnePurgeMethod
}

export function buildEdgeOnePurgeRequest(input: EdgeOnePurgeRequestInput): CreatePurgeTaskRequest {
  const zoneId = requireString(input.zoneId, 'zoneId')
  const type = parsePurgeType(input.type)
  const method = parsePurgeMethod(input.method, type)

  if (type === 'purge_all') {
    if (zoneId === '*')
      throw new EdgeOnePurgeError('purge_all 禁止使用通配 ZoneId')
    if (input.targets !== undefined)
      throw new EdgeOnePurgeError('purge_all 不接受 targets 参数')
    if (input.cacheTagDomains !== undefined)
      throw new EdgeOnePurgeError('purge_all 不接受 cacheTagDomains 参数')
    if (input.confirmAll !== zoneId)
      throw new EdgeOnePurgeError(`purge_all 必须通过 confirmAll 精确确认站点：${zoneId}`)
    return {
      ZoneId: zoneId,
      Type: type,
      ...(method ? { Method: method } : {}),
    }
  }

  const targets = parseStringArray(input.targets, 'targets')
  if (targets.length === 0)
    throw new EdgeOnePurgeError(`${type} 至少需要一个 targets`)

  let normalizedTargets: string[]
  if (type === 'purge_host')
    normalizedTargets = [...new Set(targets.map(target => requireHostname(target, 'Hostname target')))]
  else if (type === 'purge_url' || type === 'purge_prefix')
    normalizedTargets = [...new Set(targets.map(target => requireHttpUrl(target, 'targets')))]
  else
    normalizedTargets = targets

  const request: CreatePurgeTaskRequest = {
    ZoneId: zoneId,
    Type: type,
    Targets: normalizedTargets,
    ...(method ? { Method: method } : {}),
  }

  if (type === 'purge_cache_tag') {
    const domains = [...new Set(parseStringArray(input.cacheTagDomains, 'cacheTagDomains')
      .map(domain => requireHostname(domain, 'cacheTagDomains')))]
    if (domains.length === 0)
      throw new EdgeOnePurgeError('purge_cache_tag 至少需要一个 cacheTagDomains')
    request.CacheTag = { Domains: domains }
  }
  else if (input.cacheTagDomains !== undefined) {
    throw new EdgeOnePurgeError(`${type} 不支持 cacheTagDomains 参数`)
  }

  return request
}

export async function submitEdgeOnePurgeTask(
  request: CreatePurgeTaskRequest,
  client: EdgeOnePurgeClient,
): Promise<EdgeOnePurgeSubmission> {
  const response = await client.CreatePurgeTask(request)
  if (response.FailedList?.length) {
    const failures = response.FailedList
      .map(failure => `${failure.Targets.join(', ')}: ${failure.Reason}`)
      .join('; ')
    throw new EdgeOnePurgeError(`EdgeOne 拒绝了部分刷新目标：${failures}`)
  }
  if (!response.JobId)
    throw new EdgeOnePurgeError(`EdgeOne 未返回 JobId（RequestId: ${response.RequestId || 'unknown'}）`)
  return {
    jobId: response.JobId,
    ...(response.RequestId ? { requestId: response.RequestId } : {}),
  }
}
