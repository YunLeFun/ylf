import type { TicketMirrorRecord } from '../src/feishu'
import { describe, expect, it, vi } from 'vitest'
import { createFeishuTicketMirror, DEFAULT_FEISHU_TICKET_FIELDS, projectTicketMirror, syncSupportTickets, TicketMirrorError } from '../src/feishu'

const ticket = { id: 'synthetic-ticket', number: 'YLS-SYNTHETIC', productId: 'drive', status: 'triaged', priority: 'normal', version: 2, createdAt: '2026-10-27T08:45:12.345Z', updatedAt: '2026-10-27T09:45:12Z', title: 'PRIVATE_TITLE', requester: { id: 'PRIVATE_ID' }, work: { rootCause: 'PRIVATE_NOTE' }, contact: { value: 'PRIVATE_CONTACT' }, ticketUrl: 'https://support.yunle.fun/tickets/synthetic-ticket#access=PRIVATE_TOKEN' } as const
const config = { appId: 'cli_synthetic', appSecret: 'synthetic-secret', appToken: 'bascSynthetic', tableId: 'tblSynthetic' }

function fixture() {
  let remote: { record_id: string, fields: Record<string, unknown> } | undefined
  const writes: { url: string, method: string, body: Record<string, unknown> }[] = []
  const tokens: string[] = []
  let duplicate = false
  let loseCreate = false
  const fetcher: typeof fetch = async (url, init) => {
    expect(new URL(String(url)).origin).toBe('https://open.feishu.cn')
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (String(url).includes('/auth/')) {
      tokens.push(String(url))
      return Response.json({ code: 0, tenant_access_token: 'synthetic-token', expire: 7200 })
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-token')
    if (String(url).includes('/search?'))
      return Response.json({ code: 0, data: { items: remote ? duplicate ? [remote, remote] : [remote] : [], has_more: false } })
    writes.push({ url: String(url), method: String(init?.method), body })
    remote = { record_id: 'recSynthetic', fields: body.fields as Record<string, unknown> }
    if (loseCreate) {
      loseCreate = false
      throw new Error('PRIVATE_SUPPLIER_BODY')
    }
    return Response.json({ code: 0, data: { record: remote } })
  }
  return {
    fetcher,
    writes,
    tokens,
    duplicate: () => { duplicate = true },
    loseCreate: () => { loseCreate = true },
    remote: () => remote,
  }
}

describe('one-way ticket mirrors', () => {
  it('defaults to preview, bounds pagination and validates a whole product-scoped page before writing', async () => {
    const source = { query: vi.fn(async (): Promise<unknown> => ({ items: [ticket], nextCursor: '20' })) }
    const mirror = { upsert: vi.fn(async () => 'created' as const) }
    expect(await syncSupportTickets({ source, mirror, productId: 'drive' })).toMatchObject({ dryRun: true, records: 1, created: 0, nextCursor: '20' })
    expect(mirror.upsert).not.toHaveBeenCalled()
    source.query.mockResolvedValue({ items: [ticket, { ...ticket, productId: 'cook' }], nextCursor: '20' })
    await expect(syncSupportTickets({ source, mirror, productId: 'drive', dryRun: false })).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    expect(mirror.upsert).not.toHaveBeenCalled()
  })

  it('follows only advancing cursors and passes no private fields to a replaceable destination', async () => {
    const source = { query: vi.fn(async (input: { cursor?: string }) => ({ items: [ticket], ...(input.cursor ? {} : { nextCursor: '20' }) })) }
    const rows: TicketMirrorRecord[] = []
    const result = await syncSupportTickets({ source, productId: 'drive', dryRun: false, maxPages: 2, mirror: { upsert: async (row) => {
      rows.push(row)
      return 'updated'
    } } })
    expect(result).toEqual({ dryRun: false, pages: 2, records: 2, created: 0, updated: 2, newer: 0 })
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_')
    expect(Object.keys(rows[0]!)).toEqual(['id', 'number', 'productId', 'status', 'priority', 'createdAt', 'updatedAt', 'version'])
    await expect(syncSupportTickets({ source: { query: async () => ({ items: [], nextCursor: '20' }) }, productId: 'drive', cursor: '20' })).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    expect(() => projectTicketMirror({ ...ticket, status: 'unknown' }, 'drive')).toThrow(TicketMirrorError)
  })

  it('creates once, repairs after an unknown creation outcome and updates metadata without exposing private payloads', async () => {
    const f = fixture()
    const mirror = createFeishuTicketMirror({ ...config, fetch: f.fetcher })
    f.loseCreate()
    await expect(mirror.upsert(ticket)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(await mirror.upsert(ticket)).toBe('updated')
    expect(f.writes.map(write => write.method)).toEqual(['POST', 'PUT'])
    expect(new URL(f.writes[0]!.url).searchParams.get('client_token')).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-8[\da-f]{3}-[\da-f]{12}$/)
    const fields = f.remote()!.fields
    expect(fields['提交时间']).toBe(Date.parse(ticket.createdAt))
    expect(fields['状态']).toBe('已确认')
    expect(fields['工单链接']).toEqual({ text: '在 Support 中处理', link: 'https://support.yunle.fun/manage/tickets/synthetic-ticket?product=drive' })
    expect(JSON.stringify(f.writes)).not.toContain('PRIVATE_')
    expect(f.tokens).toHaveLength(1)
  })

  it('uses configurable columns and refuses duplicates or an older snapshot', async () => {
    const f = fixture()
    const mirror = createFeishuTicketMirror({ ...config, fields: { status: '处理进度' }, fetch: f.fetcher })
    expect(await mirror.upsert(ticket)).toBe('created')
    expect(f.remote()!.fields['处理进度']).toBe('已确认')
    expect(await mirror.upsert({ ...ticket, version: 1 })).toBe('newer')
    expect(f.writes).toHaveLength(1)
    f.duplicate()
    await expect(mirror.upsert(ticket)).rejects.toMatchObject({ code: 'DUPLICATE_RECORDS' })
    expect(() => createFeishuTicketMirror({ ...config, fields: { status: DEFAULT_FEISHU_TICKET_FIELDS.number } })).toThrow(TicketMirrorError)
  })

  it('contains provider failures and rejects oversized or malformed responses', async () => {
    for (const [response, code] of [[() => Response.json({ msg: 'PRIVATE_SUPPLIER_ERROR' }, { status: 429 }), 'PROVIDER_RATE_LIMITED'], [() => Response.json({ code: 99991663, msg: 'PRIVATE_SUPPLIER_ERROR' }), 'PROVIDER_AUTH_REQUIRED'], [() => new Response('PRIVATE_'.repeat(10_000)), 'INVALID_RESPONSE']] as const) {
      const mirror = createFeishuTicketMirror({ ...config, fetch: async () => response() })
      const error = await mirror.upsert(ticket).catch(error => error)
      expect(error).toMatchObject({ code })
      expect(String(error)).not.toContain('PRIVATE_')
    }
  })

  it('accepts rich-text lookup keys and refuses to update an unrelated remote row', async () => {
    const f = fixture()
    const mirror = createFeishuTicketMirror({ ...config, fetch: f.fetcher })
    await mirror.upsert(ticket)
    f.remote()!.fields['Support ID'] = [{ type: 'text', text: 'drive:synthetic-ticket' }]
    expect(await mirror.upsert(ticket)).toBe('updated')
    f.remote()!.fields['Support ID'] = 'cook:another-ticket'
    await expect(mirror.upsert(ticket)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(f.writes).toHaveLength(2)
  })

  it('rejects overlapping writes in one adapter instance and releases it after completion', async () => {
    const f = fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const mirror = createFeishuTicketMirror({ ...config, fetch: async (url, init) => {
      await gate
      return f.fetcher(url, init)
    } })
    const first = mirror.upsert(ticket)
    try {
      await expect(mirror.upsert(ticket)).rejects.toMatchObject({ code: 'SYNC_IN_PROGRESS' })
    }
    finally { release() }
    expect(await first).toBe('created')
    expect(await mirror.upsert(ticket)).toBe('updated')
  })
})
