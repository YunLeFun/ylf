import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'
import { contentType } from 'mime-types'

export interface PagesScanQuota {
  maxFiles: number
  maxTotalBytes: number
  maxFileBytes: number
}

export interface PagesFileDescriptor {
  absolutePath: string
  path: string
  size: number
  sha256: string
  contentType: string
  cacheControl: string
}

export interface PagesScanResult {
  root: string
  files: PagesFileDescriptor[]
  fileCount: number
  totalBytes: number
}

export const DEFAULT_SCAN_QUOTA: Readonly<PagesScanQuota> = Object.freeze({
  maxFiles: 10_000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFileBytes: 100 * 1024 * 1024,
})

const HASHED_FILENAME_RE = /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i
const BLOCKED_SEGMENTS = new Set(['.git', '.hg', '.svn', '__pages', 'node_modules'])
const BLOCKED_BASENAMES = new Set([
  '.netrc',
  '.npmrc',
  'credentials.json',
  'id_dsa',
  'id_ed25519',
  'id_rsa',
  'service-account.json',
])
const BLOCKED_EXTENSIONS = new Set(['.cer', '.crt', '.der', '.key', '.p12', '.pem', '.pfx'])

export class PagesScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PagesScanError'
  }
}

export function isSafePagesPath(value: string): boolean {
  return Boolean(value)
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

export function assertDeployablePath(relativePath: string): void {
  if (!isSafePagesPath(relativePath))
    throw new PagesScanError(`不安全的文件路径：${relativePath}`)
  const segments = relativePath.split('/')
  const blockedSegment = segments.find(segment => BLOCKED_SEGMENTS.has(segment))
  if (blockedSegment)
    throw new PagesScanError(`部署目录包含保留或依赖目录 ${blockedSegment}：${relativePath}`)
  const basename = segments.at(-1)!.toLowerCase()
  if (basename === '.env' || basename.startsWith('.env.') || BLOCKED_BASENAMES.has(basename))
    throw new PagesScanError(`部署目录包含敏感文件：${relativePath}`)
  if (BLOCKED_EXTENSIONS.has(path.posix.extname(basename)))
    throw new PagesScanError(`部署目录包含证书或私钥文件：${relativePath}`)
}

export function cacheControlForPagesPath(relativePath: string): string {
  const extension = path.posix.extname(relativePath).toLowerCase()
  if (extension === '.html' || extension === '.htm')
    return 'public, max-age=0, must-revalidate'
  if (HASHED_FILENAME_RE.test(path.posix.basename(relativePath)))
    return 'public, max-age=31536000, immutable'
  return 'public, max-age=3600'
}

export function orderPagesUploads(files: PagesFileDescriptor[]): PagesFileDescriptor[] {
  return [...files].sort((left, right) => {
    const rank = (file: PagesFileDescriptor) => {
      if (file.path === 'index.html')
        return 2
      return /\.html?$/.test(file.path) ? 1 : 0
    }
    return rank(left) - rank(right) || left.path.localeCompare(right.path)
  })
}

export async function scanPagesDirectory(input: {
  directory: string
  quota?: PagesScanQuota
  allowNoIndex?: boolean
  concurrency?: number
}): Promise<PagesScanResult> {
  const root = path.resolve(input.directory)
  const rootStat = await lstat(root).catch(() => null)
  if (!rootStat?.isDirectory())
    throw new PagesScanError(`静态目录不存在：${root}`)

  const quota = normalizeQuota(input.quota ?? DEFAULT_SCAN_QUOTA)
  const discovered: Array<{ absolutePath: string, path: string, size: number }> = []
  let totalBytes = 0

  async function visit(directory: string): Promise<void> {
    const entries = []
    for await (const entry of await opendir(directory))
      entries.push(entry)
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (entry.name === '.DS_Store')
        continue
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
      assertDeployablePath(relativePath)
      if (entry.isSymbolicLink())
        throw new PagesScanError(`不允许部署符号链接：${relativePath}`)
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile())
        throw new PagesScanError(`不支持的目录项：${relativePath}`)
      const stat = await lstat(absolutePath)
      if (stat.size > quota.maxFileBytes)
        throw new PagesScanError(`单文件超过限制（${quota.maxFileBytes} bytes）：${relativePath}`)
      discovered.push({ absolutePath, path: relativePath, size: stat.size })
      totalBytes += stat.size
      if (discovered.length > quota.maxFiles)
        throw new PagesScanError(`文件数量超过限制：${quota.maxFiles}`)
      if (totalBytes > quota.maxTotalBytes)
        throw new PagesScanError(`部署总大小超过限制：${quota.maxTotalBytes} bytes`)
    }
  }

  await visit(root)
  if (discovered.length === 0)
    throw new PagesScanError('静态目录为空')
  if (!input.allowNoIndex && !discovered.some(file => file.path === 'index.html'))
    throw new PagesScanError('静态目录根部必须包含 index.html；纯资源目录需显式传 --allow-no-index')

  const files = await mapLimit(discovered, normalizeConcurrency(input.concurrency), async file => ({
    ...file,
    sha256: await sha256File(file.absolutePath),
    contentType: contentType(file.path) || 'application/octet-stream',
    cacheControl: cacheControlForPagesPath(file.path),
  }))
  return { root, files, fileCount: files.length, totalBytes }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath))
    hash.update(chunk)
  return hash.digest('hex')
}

async function mapLimit<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = Array.from<R>({ length: items.length })
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

function normalizeQuota(quota: PagesScanQuota): PagesScanQuota {
  for (const [name, value] of Object.entries(quota)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new PagesScanError(`${name} 必须是正整数`)
  }
  if (quota.maxFileBytes > quota.maxTotalBytes)
    throw new PagesScanError('maxFileBytes 不能超过 maxTotalBytes')
  return quota
}

function normalizeConcurrency(value: number | undefined): number {
  return Math.max(1, Math.min(32, Number.isSafeInteger(value) ? value! : 8))
}
