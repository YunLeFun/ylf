/** Private feedback accepted by the Support server; unknown diagnostic fields are rejected. */
export interface PrivateFeedbackInput {
  readonly productId: string
  readonly category: 'problem' | 'suggestion' | 'other'
  readonly description: string
  /** Optional user-provided contact, kept separate from the feedback body and never public. */
  readonly contact?: { readonly channel: 'email' | 'wechat' | 'phone' | 'other', readonly value: string }
  readonly context?: { readonly pageUrl?: string, readonly version?: string, readonly requestId?: string, readonly errorCode?: string, readonly source?: string }
}

/** Submission acknowledgement contains no private text or identity. */
export interface FeedbackReceipt {
  readonly id: string
  readonly productId: string
  readonly status: 'received' | 'reviewing' | 'resolved'
  readonly createdAt: string
  readonly ticketId?: string
  readonly ticketUrl?: string
}

/** Stable API failure, including the request ID for support diagnostics. */
export class SupportClientError extends Error {
  constructor(readonly code: string, readonly status: number, readonly requestId?: string) {
    super(`Support request failed: ${code}`)
    this.name = 'SupportClientError'
  }
}

/** Signed bytes passed to the server-only credential provider. */
export interface SupportAssertionRequest {
  readonly body: string
  readonly method: 'POST'
  readonly path: '/api/integrations/v1/feedback'
  readonly idempotencyKey: string
}

/** Build a small fetch client. Use only from the application's trusted server. */
export function createSupportClient(options: {
  readonly baseUrl?: string
  readonly fetch?: typeof globalThis.fetch
  readonly createAssertion: (request: SupportAssertionRequest) => Promise<string>
}) {
  const origin = new URL(options.baseUrl ?? 'https://support.yunle.fun')
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new TypeError('Support baseUrl must be an exact HTTPS origin')
  const request = options.fetch ?? globalThis.fetch
  return {
    /** Retry with the same key and body after a timeout; a new assertion is signed each time. */
    async submitFeedback(input: PrivateFeedbackInput, idempotencyKey: string): Promise<FeedbackReceipt> {
      if (!/^[\w-]{8,128}$/.test(idempotencyKey))
        throw new TypeError('Provide a stable idempotency key (8–128 characters)')
      const context = input.context ? { ...input.context } : undefined
      if (context?.pageUrl) {
        const url = new URL(context.pageUrl)
        if (!['https:', 'http:'].includes(url.protocol))
          throw new TypeError('Page URL must use HTTP or HTTPS')
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        context.pageUrl = url.toString()
      }
      const signed: SupportAssertionRequest = { method: 'POST', path: '/api/integrations/v1/feedback', idempotencyKey, body: JSON.stringify({ ...input, context }) }
      const assertion = await options.createAssertion(signed)
      const response = await request(new URL(signed.path, origin), {
        method: signed.method,
        body: signed.body,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${assertion}`, 'idempotency-key': idempotencyKey },
      })
      const result: unknown = await response.json().catch(() => null)
      const data = result && typeof result === 'object' ? result as Record<string, unknown> : {}
      if (!response.ok)
        throw new SupportClientError(typeof data.code === 'string' ? data.code : 'INTERNAL_ERROR', response.status, typeof data.requestId === 'string' ? data.requestId : undefined)
      const receipt = data.receipt && typeof data.receipt === 'object' ? data.receipt as Record<string, unknown> : {}
      if (typeof receipt.id !== 'string' || receipt.productId !== input.productId || typeof receipt.createdAt !== 'string' || !['received', 'reviewing', 'resolved'].includes(String(receipt.status)) || (receipt.ticketId !== undefined && typeof receipt.ticketId !== 'string') || (receipt.ticketUrl !== undefined && (typeof receipt.ticketUrl !== 'string' || typeof receipt.ticketId !== 'string')))
        throw new SupportClientError('INVALID_RESPONSE', response.status)
      let ticketUrl: string | undefined
      if (typeof receipt.ticketUrl === 'string' && typeof receipt.ticketId === 'string') {
        let url: URL
        try {
          url = new URL(receipt.ticketUrl)
        }
        catch { throw new SupportClientError('INVALID_RESPONSE', response.status) }
        if (url.origin !== origin.origin || url.pathname !== `/tickets/${encodeURIComponent(receipt.ticketId)}` || url.username || url.password || url.search)
          throw new SupportClientError('INVALID_RESPONSE', response.status)
        ticketUrl = url.toString()
      }
      return { id: receipt.id, productId: receipt.productId, createdAt: receipt.createdAt, status: receipt.status as FeedbackReceipt['status'], ...(typeof receipt.ticketId === 'string' ? { ticketId: receipt.ticketId, ticketUrl } : {}) }
    },
  }
}
