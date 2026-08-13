import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { version } from '../../package.json'

export const PAGES_CONFIG_FILENAME = 'ylf.pages.json'
export const PAGES_SCHEMA_URL = `https://cdn.jsdelivr.net/npm/ylf@${version}/schema/ylf.pages.schema.json`

const WORKSPACE_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$/
const RESERVED_PROJECTS = new Set([
  '__pages',
  'admin',
  'api',
  'auth',
  'favicon.ico',
  'login',
  'logout',
  'robots.txt',
])
const CONFIG_KEYS = new Set(['$schema', 'workspace', 'project', 'output'])

export interface PagesConfig {
  $schema?: string
  workspace: string
  project: string
  output: string
}

export interface ResolvedPagesConfig extends PagesConfig {
  configPath: string | null
  outputDirectory: string
}

export interface PagesConfigOverrides {
  workspace?: unknown
  project?: unknown
  output?: unknown
}

export class PagesConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PagesConfigError'
  }
}

export function assertWorkspace(value: unknown): string {
  if (typeof value !== 'string' || !WORKSPACE_RE.test(value))
    throw new PagesConfigError('workspace 必须是 2–32 位小写字母、数字或中划线')
  return value
}

export function assertProject(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_RE.test(value))
    throw new PagesConfigError('project 必须是 2–48 位小写字母、数字或中划线')
  if (RESERVED_PROJECTS.has(value))
    throw new PagesConfigError(`project 使用了系统保留名称：${value}`)
  return value
}

export function normalizeConfigOutput(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new PagesConfigError('output 不能为空')
  const input = value.trim()
  if (input.includes('\\') || path.posix.isAbsolute(input))
    throw new PagesConfigError('配置文件中的 output 必须是使用 / 的相对目录')
  const normalized = path.posix.normalize(input)
  if (normalized === '..' || normalized.startsWith('../'))
    throw new PagesConfigError('配置文件中的 output 不能离开项目目录')
  return normalized.replace(/^\.\//, '')
}

export function parsePagesConfig(value: unknown): PagesConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PagesConfigError(`${PAGES_CONFIG_FILENAME} 必须是 JSON object`)
  const record = value as Record<string, unknown>
  const unknownKey = Object.keys(record).find(key => !CONFIG_KEYS.has(key))
  if (unknownKey)
    throw new PagesConfigError(`${PAGES_CONFIG_FILENAME} 包含未知字段：${unknownKey}`)
  if (record.$schema !== undefined && (typeof record.$schema !== 'string' || !record.$schema.startsWith('https://')))
    throw new PagesConfigError('$schema 必须是 HTTPS URL')

  return {
    ...(typeof record.$schema === 'string' ? { $schema: record.$schema } : {}),
    workspace: assertWorkspace(record.workspace),
    project: assertProject(record.project),
    output: normalizeConfigOutput(record.output),
  }
}

export async function findPagesConfig(startDirectory = process.cwd()): Promise<string | null> {
  let directory = path.resolve(startDirectory)
  while (true) {
    const candidate = path.join(directory, PAGES_CONFIG_FILENAME)
    try {
      await readFile(candidate, 'utf8')
      return candidate
    }
    catch (error) {
      if (!isMissingFile(error))
        throw error
    }
    const parent = path.dirname(directory)
    if (parent === directory)
      return null
    directory = parent
  }
}

export async function readPagesConfig(configPath: string): Promise<PagesConfig> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'))
  }
  catch (error) {
    if (error instanceof SyntaxError)
      throw new PagesConfigError(`${PAGES_CONFIG_FILENAME} 不是有效 JSON`)
    throw error
  }
  return parsePagesConfig(parsed)
}

export async function resolvePagesConfig(input: {
  cwd?: string
  configPath?: string
  overrides?: PagesConfigOverrides
} = {}): Promise<ResolvedPagesConfig> {
  const cwd = path.resolve(input.cwd ?? process.cwd())
  const explicitConfigPath = input.configPath ? path.resolve(cwd, input.configPath) : null
  const configPath = explicitConfigPath ?? await findPagesConfig(cwd)
  const config = configPath ? await readPagesConfig(configPath) : null
  const workspace = input.overrides?.workspace ?? config?.workspace
  const project = input.overrides?.project ?? config?.project
  const output = input.overrides?.output ?? config?.output
  if (!config && (workspace === undefined || project === undefined || output === undefined)) {
    throw new PagesConfigError(
      `未找到 ${PAGES_CONFIG_FILENAME}；请先运行 ylf pages init，或同时传入 --workspace、--project 和 --directory`,
    )
  }
  const baseDirectory = configPath ? path.dirname(configPath) : cwd
  const normalizedOutput = config && input.overrides?.output === undefined
    ? normalizeConfigOutput(output)
    : requireDirectOutput(output)
  return {
    ...(config?.$schema ? { $schema: config.$schema } : {}),
    workspace: assertWorkspace(workspace),
    project: assertProject(project),
    output: normalizedOutput,
    configPath,
    outputDirectory: path.resolve(baseDirectory, normalizedOutput),
  }
}

export async function initializePagesConfig(input: {
  directory?: string
  workspace: unknown
  project: unknown
  output: unknown
  force?: boolean
}): Promise<{ config: PagesConfig, configPath: string }> {
  const directory = path.resolve(input.directory ?? process.cwd())
  const configPath = path.join(directory, PAGES_CONFIG_FILENAME)
  if (!input.force) {
    try {
      await readFile(configPath, 'utf8')
      throw new PagesConfigError(`${PAGES_CONFIG_FILENAME} 已存在；如需覆盖请传 --force`)
    }
    catch (error) {
      if (!isMissingFile(error))
        throw error
    }
  }
  const config: PagesConfig = {
    $schema: PAGES_SCHEMA_URL,
    workspace: assertWorkspace(input.workspace),
    project: assertProject(input.project),
    output: normalizeConfigOutput(input.output),
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 })
  return { config, configPath }
}

function requireDirectOutput(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new PagesConfigError('--directory 不能为空')
  return value.trim()
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
