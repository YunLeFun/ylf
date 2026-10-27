/** Current Support link and context protocol version. */
export const SUPPORT_PROTOCOL_VERSION = '1' as const

/** Canonical production origin for Yunle Support. */
export const DEFAULT_SUPPORT_ORIGIN = 'https://support.yunle.fun' as const

/** Product identifiers accepted by the first protocol version. */
export const SUPPORT_PRODUCTS = ['www', 'cook', 'play', 'yunbox', 'drive', 'cms', 'advjs'] as const

/** User intents accepted by the first protocol version. */
export const SUPPORT_INTENTS = [
  'help',
  'ticket',
  'feedback',
  'roadmap',
  'status',
  'security',
  'login',
] as const

/** Maximum URL length produced by the client. */
export const MAX_SUPPORT_URL_LENGTH = 4_096

/** Product identifier recognized by the Support client. */
export type SupportProduct = typeof SUPPORT_PRODUCTS[number]

/** User task selected before entering Support. */
export type SupportIntent = typeof SUPPORT_INTENTS[number]

/** Stable error codes emitted by the framework-independent client. */
export type SupportClientErrorCode
  = | 'INVALID_INPUT'
    | 'INVALID_ORIGIN'
    | 'UNKNOWN_INTENT'
    | 'UNKNOWN_PRODUCT'
    | 'UNSUPPORTED_PROTOCOL'

/** Safe technical context that may be carried in a Support URL. */
export interface SupportLinkContext {
  /** Product error code, never a full log or stack trace. */
  readonly errorCode?: string
  /** Public page URL with query and fragment removed. */
  readonly pageUrl?: string
  /** Opaque request correlation identifier. */
  readonly requestId?: string
  /** Calling application version. */
  readonly version?: string
}

interface SupportLinkInputBase {
  /** Optional user-reviewed technical context. */
  readonly context?: SupportLinkContext
  /** Calling YunLeFun product. */
  readonly product: SupportProduct
  /** Optional calling module or surface. */
  readonly source?: string
}

/**
 * Input for constructing a Support URL.
 *
 * `type` is accepted as the wire-compatible R1 name; `intent` is the clearer
 * application-facing alias. Callers provide exactly one.
 */
export type SupportLinkInput = SupportLinkInputBase & (
  | { readonly intent: SupportIntent, readonly type?: never }
  | { readonly intent?: never, readonly type: SupportIntent }
)

/** Options controlling Support URL construction or parsing. */
export interface SupportUrlOptions {
  /** HTTPS Support origin, or an HTTP loopback origin for local development. */
  readonly origin?: string
}

/** Sanitized Support link data parsed from the versioned wire format. */
export interface ParsedSupportLink {
  readonly context: SupportLinkContext
  readonly intent: SupportIntent
  readonly product: SupportProduct
  readonly protocolVersion: typeof SUPPORT_PROTOCOL_VERSION
  readonly source?: string
}

/** Stable client-side protocol failure. */
export class SupportClientError extends Error {
  readonly code: SupportClientErrorCode

  constructor(code: SupportClientErrorCode, message: string) {
    super(message)
    this.name = 'SupportClientError'
    this.code = code
  }
}

const intentPaths: Readonly<Record<SupportIntent, string>> = {
  feedback: '/feedback/new',
  help: '/help',
  login: '/login-help',
  roadmap: '/roadmap',
  security: '/security',
  status: '/status',
  ticket: '/tickets/new',
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSupportProduct(value: string): value is SupportProduct {
  return (SUPPORT_PRODUCTS as readonly string[]).includes(value)
}

function isSupportIntent(value: string): value is SupportIntent {
  return (SUPPORT_INTENTS as readonly string[]).includes(value)
}

function parseRequiredProduct(value: unknown): SupportProduct {
  if (typeof value !== 'string' || !isSupportProduct(value))
    throw new SupportClientError('UNKNOWN_PRODUCT', 'Support product is not recognized')
  return value
}

function parseRequiredIntent(value: unknown): SupportIntent {
  if (typeof value !== 'string' || !isSupportIntent(value))
    throw new SupportClientError('UNKNOWN_INTENT', 'Support intent is not recognized')
  return value
}

function optionalString(value: unknown, pattern: RegExp, maxLength: number): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const normalized = value.trim()
  return normalized.length >= 1 && normalized.length <= maxLength && pattern.test(normalized)
    ? normalized
    : undefined
}

function sanitizeOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new SupportClientError('INVALID_ORIGIN', 'Support origin is not a valid URL')
  }

  const loopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'
  const allowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && loopback)
  if (!allowedProtocol || url.username || url.password) {
    throw new SupportClientError('INVALID_ORIGIN', 'Support origin must use HTTPS without credentials')
  }

  return url.origin
}

function sanitizePageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4_096)
    return undefined

  try {
    const url = new URL(value)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password)
      return undefined
    url.search = ''
    url.hash = ''
    const result = url.toString()
    return result.length <= 2_048 ? result : undefined
  }
  catch {
    return undefined
  }
}

function sanitizeContext(value: unknown): SupportLinkContext {
  if (!isRecord(value))
    return {}

  return {
    errorCode: optionalString(value.errorCode, /^[A-Z0-9][\w.:-]*$/i, 128),
    pageUrl: sanitizePageUrl(value.pageUrl),
    requestId: optionalString(value.requestId, /^[A-Z0-9][\w.:-]*$/i, 128),
    version: optionalString(value.version, /^[A-Z0-9][\w.+-]*$/i, 64),
  }
}

function appendOptional(searchParams: URLSearchParams, key: string, value: string | undefined): void {
  if (value)
    searchParams.set(key, value)
}

/**
 * Build a sanitized, versioned Support URL from unknown runtime input.
 *
 * Unknown context keys are discarded. Page queries and fragments are removed,
 * preventing tokens, cookies, full logs, or arbitrary payloads from entering a
 * copied URL or access log.
 */
export function buildSupportUrl(input: unknown, options: SupportUrlOptions = {}): string {
  if (!isRecord(input))
    throw new SupportClientError('INVALID_INPUT', 'Support link input must be an object')

  const product = parseRequiredProduct(input.product)
  const intent = parseRequiredIntent(input.intent ?? input.type)
  const source = optionalString(input.source, /^[A-Z0-9][\w.-]*$/i, 64)
  const context = sanitizeContext(input.context)
  const origin = sanitizeOrigin(options.origin ?? DEFAULT_SUPPORT_ORIGIN)
  const url = new URL(intentPaths[intent], origin)

  url.searchParams.set('v', SUPPORT_PROTOCOL_VERSION)
  url.searchParams.set('product', product)
  url.searchParams.set('type', intent)
  appendOptional(url.searchParams, 'source', source)
  appendOptional(url.searchParams, 'page', context.pageUrl)
  appendOptional(url.searchParams, 'appVersion', context.version)
  appendOptional(url.searchParams, 'requestId', context.requestId)
  appendOptional(url.searchParams, 'errorCode', context.errorCode)

  const result = url.toString()
  if (result.length > MAX_SUPPORT_URL_LENGTH)
    throw new SupportClientError('INVALID_INPUT', 'Support URL exceeds the safe length limit')
  return result
}

/**
 * Parse and sanitize a Support URL.
 *
 * URLs without `v` are treated as legacy version 1 links. Explicit future or
 * unsupported versions fail closed so callers never reinterpret new fields.
 */
export function parseSupportUrl(input: string | URL, options: SupportUrlOptions = {}): ParsedSupportLink {
  const expectedOrigin = sanitizeOrigin(options.origin ?? DEFAULT_SUPPORT_ORIGIN)
  let url: URL
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(input)
  }
  catch {
    throw new SupportClientError('INVALID_INPUT', 'Support URL is invalid')
  }

  if (url.origin !== expectedOrigin)
    throw new SupportClientError('INVALID_ORIGIN', 'Support URL origin does not match')

  const version = url.searchParams.get('v') ?? SUPPORT_PROTOCOL_VERSION
  if (version !== SUPPORT_PROTOCOL_VERSION)
    throw new SupportClientError('UNSUPPORTED_PROTOCOL', 'Support URL protocol version is not supported')

  return {
    context: sanitizeContext({
      errorCode: url.searchParams.get('errorCode'),
      pageUrl: url.searchParams.get('page'),
      requestId: url.searchParams.get('requestId'),
      version: url.searchParams.get('appVersion'),
    }),
    intent: parseRequiredIntent(url.searchParams.get('type')),
    product: parseRequiredProduct(url.searchParams.get('product')),
    protocolVersion: SUPPORT_PROTOCOL_VERSION,
    source: optionalString(url.searchParams.get('source'), /^[A-Z0-9][\w.-]*$/i, 64),
  }
}
export * from './feedback'
// Keep the URL protocol error compatible while exposing the distinct HTTP error.
export { SupportClientError as SupportApiError } from './feedback'
