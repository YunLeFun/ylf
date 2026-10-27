import { describe, expect, it } from 'vitest'
import { createSupportClient, SupportApiError, SupportClientError } from '../src'
import { SupportApiError as ServerApiError } from '../src/server'

const input = { productId: 'drive', category: 'problem', description: 'Synthetic integration feedback' } as const
const receipt = { id: 'feedback-one', productId: 'drive', status: 'received', createdAt: '2026-10-27T00:00:00Z', ticketId: 'feedback-one', ticketUrl: 'https://support.yunle.fun/tickets/feedback-one#access=synthetic-token' }

describe('reusable submission client', () => {
  it('exposes HTTP errors separately from URL protocol errors through both supported entries', async () => {
    const client = createSupportClient({ createAssertion: async () => 'synthetic-assertion', fetch: async () => Response.json({ code: 'RATE_LIMITED', requestId: 'safe-request-id' }, { status: 429 }) })
    const error = await client.submitFeedback(input, 'stable-submission-key').catch(error => error)
    expect(error).toBeInstanceOf(SupportApiError)
    expect(error).toBeInstanceOf(ServerApiError)
    expect(error).not.toBeInstanceOf(SupportClientError)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, requestId: 'safe-request-id' })
  })

  it('returns only acknowledgement fields and preserves the private return link', async () => {
    const client = createSupportClient({ createAssertion: async () => 'synthetic', fetch: async () => Response.json({ receipt: { ...receipt, description: 'private body', contact: 'private contact' } }) })
    expect(await client.submitFeedback(input, 'stable-submission-key')).toEqual(receipt)
  })

  it('rejects cross-product, malformed or unrelated ticket links with the stable HTTP error', async () => {
    for (const change of [{ productId: 'cook' }, { ticketUrl: 'not-a-url' }, { ticketUrl: 'https://other.invalid/tickets/feedback-one' }, { ticketId: undefined }, { ticketId: 42 }, { ticketUrl: 'https://support.yunle.fun/tickets/other' }]) {
      const client = createSupportClient({ createAssertion: async () => 'synthetic', fetch: async () => Response.json({ receipt: { ...receipt, ...change } }) })
      await expect(client.submitFeedback(input, 'stable-submission-key')).rejects.toBeInstanceOf(SupportApiError)
      await expect(client.submitFeedback(input, 'stable-submission-key')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    }
  })
})
