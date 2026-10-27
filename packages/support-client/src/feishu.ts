import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

const statuses = { new: '已收到', triaged: '已确认', in_progress: '处理中', waiting_user: '等待补充', resolved: '已解决', closed: '已关闭' }
const priorities = { low: '低', normal: '普通', high: '高', urgent: '紧急' }

/** Minimal, non-public operational metadata; no user content or access tokens. */
export interface TicketMirrorRecord {
  readonly id: string
  readonly number: string
  readonly productId: string
  readonly status: keyof typeof statuses
  readonly priority: keyof typeof priorities
  readonly createdAt: string
  readonly updatedAt: string
  readonly version: number
}

/** Replaceable one-way destination; it never receives a complete managed ticket. */
export interface TicketMirrorPort {
  upsert: (record: TicketMirrorRecord) => Promise<'created' | 'updated' | 'newer'>
}

/** Column names. Create these fields in an existing, access-controlled Feishu table. */
export const DEFAULT_FEISHU_TICKET_FIELDS = {
  key: 'Support ID',
  number: '工单编号',
  product: '产品',
  status: '状态',
  priority: '优先级',
  createdAt: '提交时间',
  updatedAt: '更新时间',
  url: '工单链接',
  version: 'Support 版本',
} as const

/** Server-only Feishu custom application and destination settings. */
export interface FeishuTicketMirrorOptions {
  readonly appId: string
  readonly appSecret: string
  readonly appToken: string
  readonly tableId: string
  readonly supportOrigin?: string
  readonly fields?: Partial<Record<keyof typeof DEFAULT_FEISHU_TICKET_FIELDS, string>>
  readonly fetch?: typeof globalThis.fetch
}

/** Stable diagnostics suitable for logs; no supplier messages, URLs or payloads. */
export class TicketMirrorError extends Error {
  constructor(readonly code: 'INVALID_CONFIGURATION' | 'INVALID_SOURCE' | 'INVALID_RESPONSE' | 'PROVIDER_AUTH_REQUIRED' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'DUPLICATE_RECORDS' | 'SYNC_IN_PROGRESS') {
    super(code)
    this.name = 'TicketMirrorError'
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,128}$/.test(value)
}
function instant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}
function text(value: unknown): string | undefined {
  if (typeof value === 'string')
    return value
  if (Array.isArray(value) && value.every(part => typeof record(part).text === 'string'))
    return value.map(part => String(record(part).text)).join('')
  return undefined
}

/** Project unknown API data through an explicit whitelist and enforce product isolation. */
export function projectTicketMirror(value: unknown, productId: string): TicketMirrorRecord {
  const row = record(value)
  if (!identifier(row.id) || !identifier(productId) || row.productId !== productId || typeof row.number !== 'string' || !row.number.trim() || row.number.length > 128
    || typeof row.status !== 'string' || !Object.hasOwn(statuses, row.status) || typeof row.priority !== 'string' || !Object.hasOwn(priorities, row.priority)
    || !instant(row.createdAt) || !instant(row.updatedAt) || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new TicketMirrorError('INVALID_SOURCE')
  }
  return { id: row.id, number: row.number, productId, status: row.status as TicketMirrorRecord['status'], priority: row.priority as TicketMirrorRecord['priority'], createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version }
}

/** Bounded reconciliation result; safe to print without disclosing ticket identifiers. */
export interface TicketMirrorSyncResult {
  readonly dryRun: boolean
  readonly pages: number
  readonly records: number
  readonly created: number
  readonly updated: number
  readonly newer: number
  readonly nextCursor?: string
}

/** Run serially per destination. Defaults to one page and a read-only preview. Retry a failed page unchanged. */
export async function syncSupportTickets(options: {
  readonly productId: string
  readonly source: { query: (input: { productId: string, cursor?: string }) => Promise<unknown> }
  readonly mirror?: TicketMirrorPort
  readonly dryRun?: boolean
  readonly cursor?: string
  readonly maxPages?: number
}): Promise<TicketMirrorSyncResult> {
  const dryRun = options.dryRun !== false
  const maxPages = options.maxPages ?? 1
  const validCursor = (value: unknown): value is string => typeof value === 'string' && /^(?:0|[1-9]\d{0,6})$/.test(value)
  if (!identifier(options.productId) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 || (!dryRun && !options.mirror) || (options.cursor !== undefined && !validCursor(options.cursor)))
    throw new TicketMirrorError('INVALID_CONFIGURATION')
  const counts = { pages: 0, records: 0, created: 0, updated: 0, newer: 0 }
  let cursor = options.cursor
  do {
    const page = record(await options.source.query({ productId: options.productId, cursor }))
    if (!Array.isArray(page.items) || page.items.length > 20 || (page.nextCursor !== undefined && (!validCursor(page.nextCursor) || Number(page.nextCursor) <= Number(cursor ?? 0))))
      throw new TicketMirrorError('INVALID_SOURCE')
    // Validate the complete page before the first external write.
    const rows = page.items.map(item => projectTicketMirror(item, options.productId))
    for (const row of rows) {
      if (!dryRun)
        counts[await options.mirror!.upsert(row)]++
      counts.records++
    }
    counts.pages++
    cursor = page.nextCursor
  } while (cursor !== undefined && counts.pages < maxPages)
  return { dryRun, ...counts, ...(cursor !== undefined ? { nextCursor: cursor } : {}) }
}

function origin(value = 'https://support.yunle.fun'): string {
  let url: URL
  try {
    url = new URL(value)
  }
  catch { throw new TicketMirrorError('INVALID_CONFIGURATION') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new TicketMirrorError('INVALID_CONFIGURATION')
  return url.origin
}

/** Create an existing-table adapter with fixed Feishu endpoints and no reverse updates to Support. */
export function createFeishuTicketMirror(options: FeishuTicketMirrorOptions): TicketMirrorPort {
  const supportOrigin = origin(options.supportOrigin)
  if (![options.appId, options.appToken, options.tableId].every(identifier) || typeof options.appSecret !== 'string' || !options.appSecret || options.appSecret.length > 512)
    throw new TicketMirrorError('INVALID_CONFIGURATION')
  const fields = { ...DEFAULT_FEISHU_TICKET_FIELDS, ...options.fields }
  if (Object.values(fields).some(name => typeof name !== 'string' || !name.trim() || name.length > 100) || new Set(Object.values(fields)).size !== 9)
    throw new TicketMirrorError('INVALID_CONFIGURATION')
  const transport = options.fetch ?? globalThis.fetch
  const base = `/bitable/v1/apps/${options.appToken}/tables/${options.tableId}/records`
  let token: { value: string, expiresAt: number } | undefined
  let busy = false

  async function request(path: string, method: string, body: object, accessToken?: string): Promise<Record<string, unknown>> {
    try {
      const response = await transport(`https://open.feishu.cn/open-apis${path}`, { method, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) } })
      if (!response.ok) {
        await response.body?.cancel()
        throw new TicketMirrorError(response.status === 429 ? 'PROVIDER_RATE_LIMITED' : response.status === 401 ? 'PROVIDER_AUTH_REQUIRED' : response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED')
      }
      const reader = response.body?.getReader()
      if (!reader)
        throw new TicketMirrorError('INVALID_RESPONSE')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const next = await reader.read()
          if (next.done)
            break
          size += next.value.byteLength
          if (size > 65_536) {
            await reader.cancel()
            throw new TicketMirrorError('INVALID_RESPONSE')
          }
          chunks.push(next.value)
        }
      }
      finally { reader.releaseLock() }
      let data: Record<string, unknown>
      try {
        data = record(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      }
      catch { throw new TicketMirrorError('INVALID_RESPONSE') }
      if (typeof data.code !== 'number')
        throw new TicketMirrorError('INVALID_RESPONSE')
      if (data.code !== 0)
        throw new TicketMirrorError([99991663, 99991677].includes(data.code) ? 'PROVIDER_AUTH_REQUIRED' : [99991400, 1254290].includes(data.code) ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REJECTED')
      return data
    }
    catch (error) { throw error instanceof TicketMirrorError ? error : new TicketMirrorError('PROVIDER_UNAVAILABLE') }
  }
  async function authenticated(path: string, method: string, body: object) {
    if (!token || token.expiresAt <= Date.now()) {
      const result = await request('/auth/v3/tenant_access_token/internal', 'POST', { app_id: options.appId, app_secret: options.appSecret })
      if (typeof result.tenant_access_token !== 'string' || !result.tenant_access_token || typeof result.expire !== 'number' || result.expire <= 60 || result.expire > 86_400)
        throw new TicketMirrorError('INVALID_RESPONSE')
      token = { value: result.tenant_access_token, expiresAt: Date.now() + (result.expire - 60) * 1000 }
    }
    try {
      return await request(path, method, body, token.value)
    }
    catch (error) {
      if (error instanceof TicketMirrorError && error.code === 'PROVIDER_AUTH_REQUIRED')
        token = undefined
      throw error
    }
  }

  return {
    async upsert(input) {
      if (busy)
        throw new TicketMirrorError('SYNC_IN_PROGRESS')
      busy = true
      try {
        const row = projectTicketMirror(input, input.productId)
        const key = `${row.productId}:${row.id}`
        const lookup = record((await authenticated(`${base}/search?page_size=2`, 'POST', { field_names: [fields.key, fields.version], automatic_fields: false, filter: { conjunction: 'and', conditions: [{ field_name: fields.key, operator: 'is', value: [key] }] } })).data)
        if (!Array.isArray(lookup.items) || typeof lookup.has_more !== 'boolean')
          throw new TicketMirrorError('INVALID_RESPONSE')
        if (lookup.items.length > 1 || lookup.has_more)
          throw new TicketMirrorError('DUPLICATE_RECORDS')
        const existing = lookup.items.length ? record(lookup.items[0]) : undefined
        const remoteFields = record(existing?.fields)
        if (existing && (!identifier(existing.record_id) || text(remoteFields[fields.key]) !== key || (remoteFields[fields.version] !== undefined && (typeof remoteFields[fields.version] !== 'number' || !Number.isSafeInteger(remoteFields[fields.version]) || Number(remoteFields[fields.version]) < 1))))
          throw new TicketMirrorError('INVALID_RESPONSE')
        if (existing && Number(remoteFields[fields.version]) > row.version)
          return 'newer'
        const link = new URL(`/manage/tickets/${encodeURIComponent(row.id)}`, supportOrigin)
        link.searchParams.set('product', row.productId)
        const values = { [fields.key]: key, [fields.number]: row.number, [fields.product]: row.productId, [fields.status]: statuses[row.status], [fields.priority]: priorities[row.priority], [fields.createdAt]: Date.parse(row.createdAt), [fields.updatedAt]: Date.parse(row.updatedAt), [fields.url]: { link: link.toString(), text: '在 Support 中处理' }, [fields.version]: row.version }
        // Stable UUIDv4-format creation token, reused after unknown outcomes. Search remains the recovery path.
        const hex = createHash('sha256').update(`${supportOrigin}:${options.appToken}:${options.tableId}:${key}`).digest('hex')
        const clientToken = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
        const result = await authenticated(existing ? `${base}/${existing.record_id}` : `${base}?client_token=${clientToken}`, existing ? 'PUT' : 'POST', { fields: values })
        const remote = record(record(result.data).record)
        if (!identifier(remote.record_id) || (existing && remote.record_id !== existing.record_id))
          throw new TicketMirrorError('INVALID_RESPONSE')
        return existing ? 'updated' : 'created'
      }
      finally { busy = false }
    },
  }
}
