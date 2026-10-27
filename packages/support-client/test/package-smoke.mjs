import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import process from 'node:process'
import { buildSupportUrl, createSupportClient, SupportApiError, SupportClientError } from '@yunlefun/support-client'
import { createFeishuTicketMirror, projectTicketMirror, syncSupportTickets } from '@yunlefun/support-client/feishu'
import { createSupportAgentClient, createSupportServerClient, SupportApiError as ServerApiError } from '@yunlefun/support-client/server'

async function main() {
  assert.equal(SupportApiError, ServerApiError)
  assert.notEqual(SupportApiError, SupportClientError)
  assert.equal(new URL(buildSupportUrl({ product: 'drive', intent: 'feedback' })).searchParams.get('product'), 'drive')
  const root = await import('@yunlefun/support-client')
  assert.equal(root.createFeishuTicketMirror, undefined)
  assert.equal(root.createSupportServerClient, undefined)
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const receipt = { id: 'synthetic-feedback', productId: 'drive', status: 'received', createdAt: '2026-10-27T00:00:00.123Z', ticketId: 'synthetic-feedback', ticketUrl: 'https://support.yunle.fun/tickets/synthetic-feedback#access=synthetic' }
  let submissions = 0
  const client = createSupportServerClient({
    clientId: 'synthetic-server',
    keyId: 'synthetic-key',
    userId: 'synthetic_user',
    privateKey,
    fetch: async (_url, init) => {
      assert.equal(init.redirect, 'error')
      const body = JSON.parse(init.body)
      assert.deepEqual(body.contact, { channel: 'email', value: 'synthetic@example.invalid' })
      assert.equal(new URL(body.context.pageUrl).search, '')
      const assertion = init.headers.authorization.replace('Bearer ', '')
      assert.equal(assertion.split('.').length, 3)
      submissions++
      return Response.json({ receipt })
    },
  })
  assert.deepEqual(await client.submitFeedback({ productId: 'drive', category: 'problem', description: 'Synthetic installation feedback', contact: { channel: 'email', value: 'synthetic@example.invalid' }, context: { pageUrl: 'https://example.invalid/page?discard=synthetic' } }, 'synthetic-submission-key'), receipt)
  assert.equal(submissions, 1)
  const failed = createSupportClient({ createAssertion: async () => 'synthetic', fetch: async () => Response.json({ code: 'RATE_LIMITED' }, { status: 429 }) })
  await assert.rejects(failed.submitFeedback({ productId: 'drive', category: 'problem', description: 'Synthetic installation feedback' }, 'synthetic-failed-key'), error => error instanceof ServerApiError && error.status === 429)
  const source = createSupportAgentClient({ clientId: 'synthetic-mirror', keyId: 'synthetic-key', userId: 'synthetic_user', privateKey, fetch: async () => Response.json({ items: [] }) })
  assert.deepEqual(await source.query({ productId: 'drive' }), { items: [] })
  const row = { id: 'synthetic-ticket', number: 'SYN-1', productId: 'drive', status: 'new', priority: 'normal', createdAt: '2026-10-27T00:00:00.123Z', updatedAt: '2026-10-27T00:00:00.123Z', version: 1, description: 'must be discarded', contact: 'must be discarded' }
  assert.equal(Object.keys(projectTicketMirror(row, 'drive')).length, 8)
  let writes = 0
  const mirror = createFeishuTicketMirror({ appId: 'synthetic-app', appSecret: 'synthetic-secret', appToken: 'synthetic-base', tableId: 'synthetic-table', fetch: async () => {
    writes++
    throw new Error('Unexpected network')
  } })
  assert.deepEqual(await syncSupportTickets({ productId: 'drive', source: { query: async () => ({ items: [row] }) }, mirror }), { dryRun: true, pages: 1, records: 1, created: 0, updated: 0, newer: 0 })
  assert.equal(writes, 0)
  console.log('Installed package: all three entry points, signatures, safe receipt, error identity, whitelist and dry-run passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
