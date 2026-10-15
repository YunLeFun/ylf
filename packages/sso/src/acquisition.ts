/** Optional, client-reported acquisition data. It never establishes application identity. */
export interface AcquisitionTouch {
  capturedAt: number
  landingHost: string
  landingPath: string
  referrerHost: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
}

export interface AcquisitionContext {
  version: 1
  firstTouch: AcquisitionTouch
  registerTouch: AcquisitionTouch
}

export const ACQUISITION_MAX_BYTES = 4096
// eslint-disable-next-line no-control-regex -- Attribution must reject control characters.
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/
const UTM_RE = /^[\p{L}\p{N}\p{M} ._/-]*$/u

/** Return a bounded, allowlisted copy, or null without affecting authentication. */
export function sanitizeAcquisitionContext(input: unknown): AcquisitionContext | null {
  try {
    if (!isRecord(input) || input.version !== 1)
      return null
    const firstTouch = readTouch(input.firstTouch)
    const registerTouch = readTouch(input.registerTouch)
    if (!firstTouch || !registerTouch)
      return null
    const context: AcquisitionContext = { version: 1, firstTouch, registerTouch }
    return byteLength(JSON.stringify(context)) <= ACQUISITION_MAX_BYTES ? context : null
  }
  catch {
    return null
  }
}

/** Reads either an object or an already URI-decoded query value. */
export function readAcquisitionContext(input: unknown): AcquisitionContext | null {
  return typeof input === 'string'
    ? decodeAcquisitionContext(input)
    : sanitizeAcquisitionContext(input)
}

/** UTF-8 JSON; URLSearchParams performs the one required URI-encoding step. */
export function encodeAcquisitionContext(input: unknown): string {
  const context = sanitizeAcquisitionContext(input)
  return context ? JSON.stringify(context) : ''
}

/** The caller supplies URLSearchParams.get() / router query, never a second decodeURIComponent. */
export function decodeAcquisitionContext(input: unknown): AcquisitionContext | null {
  if (typeof input !== 'string' || byteLength(input) > ACQUISITION_MAX_BYTES)
    return null
  try {
    return sanitizeAcquisitionContext(JSON.parse(input))
  }
  catch {
    return null
  }
}

function readTouch(input: unknown): AcquisitionTouch | null {
  if (!isRecord(input) || !Number.isSafeInteger(input.capturedAt) || Number(input.capturedAt) <= 0)
    return null
  const landingHost = readHost(input.landingHost, false)
  const referrerHost = readHost(input.referrerHost, true)
  const landingPath = readPath(input.landingPath)
  const utmSource = readUtm(input.utmSource)
  const utmMedium = readUtm(input.utmMedium)
  const utmCampaign = readUtm(input.utmCampaign)
  if (landingHost === null || referrerHost === null || landingPath === null
    || utmSource === null || utmMedium === null || utmCampaign === null) {
    return null
  }
  return {
    capturedAt: Number(input.capturedAt),
    landingHost,
    landingPath,
    referrerHost,
    utmSource,
    utmMedium,
    utmCampaign,
  }
}

function readHost(input: unknown, allowEmpty: boolean): string | null {
  if (typeof input !== 'string' || input.length > 253 || CONTROL_RE.test(input))
    return null
  if (input === '')
    return allowEmpty ? '' : null
  const host = input.toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')
    || host.split('.').some(label => !label || label.length > 63
      || label.startsWith('-') || label.endsWith('-'))) {
    return null
  }
  return new URL(`https://${host}`).hostname === host ? host : null
}

function readPath(input: unknown): string | null {
  if (typeof input !== 'string' || CONTROL_RE.test(input) || /%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(input)
    || !input.startsWith('/') || input.startsWith('//') || input.includes('\\')) {
    return null
  }
  // Only the pathname survives. Never persist tokens or identifiers from search/hash.
  return input.split(/[?#]/, 1)[0]!.slice(0, 256)
}

function readUtm(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 120 || CONTROL_RE.test(input) || !UTM_RE.test(input))
    return null
  return input.trim()
}

function byteLength(input: string): number {
  return new TextEncoder().encode(input).byteLength
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}
