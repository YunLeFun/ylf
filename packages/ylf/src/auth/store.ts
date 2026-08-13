import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const KEYCHAIN_SERVICE = 'fun.yunle.ylf-cli'
const KEYCHAIN_ACCOUNT = 'default'

export interface StoredAuthSession {
  version: 1
  apiBaseUrl: string
  accessToken: string
  accessExpiresAt: number
  refreshToken: string
  refreshExpiresAt: number
}

export interface AuthTokenStore {
  kind: 'keychain' | 'file'
  location: string
  load: () => Promise<StoredAuthSession | null>
  save: (session: StoredAuthSession) => Promise<void>
  clear: () => Promise<void>
}

export function parseStoredAuthSession(value: unknown): StoredAuthSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const record = value as Record<string, unknown>
  if (record.version !== 1
    || typeof record.apiBaseUrl !== 'string'
    || typeof record.accessToken !== 'string'
    || typeof record.accessExpiresAt !== 'number'
    || typeof record.refreshToken !== 'string'
    || typeof record.refreshExpiresAt !== 'number') {
    return null
  }
  return record as unknown as StoredAuthSession
}

export class FileAuthTokenStore implements AuthTokenStore {
  readonly kind = 'file' as const
  readonly location: string

  constructor(filePath = defaultAuthFile()) {
    this.location = filePath
  }

  async load(): Promise<StoredAuthSession | null> {
    try {
      return parseStoredAuthSession(JSON.parse(await readFile(this.location, 'utf8')))
    }
    catch (error) {
      if (isMissing(error) || error instanceof SyntaxError)
        return null
      throw error
    }
  }

  async save(session: StoredAuthSession): Promise<void> {
    const directory = path.dirname(this.location)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temporary = `${this.location}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(session)}\n`, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.location)
    await chmod(this.location, 0o600)
  }

  async clear(): Promise<void> {
    await rm(this.location, { force: true })
  }
}

class MacOsKeychainTokenStore implements AuthTokenStore {
  readonly kind = 'keychain' as const
  readonly location = 'macOS Keychain'

  async load(): Promise<StoredAuthSession | null> {
    const result = await runCommand('security', [
      'find-generic-password',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
    ], undefined, true)
    if (result.code !== 0)
      return null
    try {
      return parseStoredAuthSession(JSON.parse(result.stdout.trim()))
    }
    catch {
      return null
    }
  }

  async save(session: StoredAuthSession): Promise<void> {
    const serialized = JSON.stringify(session)
    const result = await runCommand('security', [
      'add-generic-password',
      '-U',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
      serialized,
    ])
    if (result.code !== 0)
      throw new Error('无法写入 macOS Keychain')
  }

  async clear(): Promise<void> {
    await runCommand('security', [
      'delete-generic-password',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      KEYCHAIN_SERVICE,
    ], undefined, true)
  }
}

class LinuxSecretServiceTokenStore implements AuthTokenStore {
  readonly kind = 'keychain' as const
  readonly location = 'Secret Service'

  async load(): Promise<StoredAuthSession | null> {
    const result = await runCommand('secret-tool', [
      'lookup',
      'service',
      KEYCHAIN_SERVICE,
      'account',
      KEYCHAIN_ACCOUNT,
    ], undefined, true)
    if (result.code !== 0 || !result.stdout.trim())
      return null
    try {
      return parseStoredAuthSession(JSON.parse(result.stdout.trim()))
    }
    catch {
      return null
    }
  }

  async save(session: StoredAuthSession): Promise<void> {
    const result = await runCommand('secret-tool', [
      'store',
      '--label=YunLeFun CLI',
      'service',
      KEYCHAIN_SERVICE,
      'account',
      KEYCHAIN_ACCOUNT,
    ], JSON.stringify(session))
    if (result.code !== 0)
      throw new Error('无法写入 Secret Service')
  }

  async clear(): Promise<void> {
    await runCommand('secret-tool', [
      'clear',
      'service',
      KEYCHAIN_SERVICE,
      'account',
      KEYCHAIN_ACCOUNT,
    ], undefined, true)
  }
}

export async function createAuthTokenStore(options: {
  platform?: NodeJS.Platform
  filePath?: string
} = {}): Promise<AuthTokenStore> {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin' && await commandAvailable('security'))
    return new MacOsKeychainTokenStore()
  if (platform === 'linux' && await commandAvailable('secret-tool'))
    return new LinuxSecretServiceTokenStore()
  return new FileAuthTokenStore(options.filePath)
}

function defaultAuthFile(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config')
  return path.join(base, 'ylf', 'auth.json')
}

async function commandAvailable(command: string): Promise<boolean> {
  const result = await runCommand(command, ['--help'], undefined, true)
  return result.code === 0 || result.code === 1
}

function runCommand(
  command: string,
  args: string[],
  input?: string,
  allowFailure = false,
): Promise<{ code: number, stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)))
    child.on('error', (error) => {
      if (allowFailure && (error as NodeJS.ErrnoException).code === 'ENOENT')
        resolve({ code: 127, stdout: '' })
      else
        reject(error)
    })
    child.on('close', code => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString('utf8') }))
    if (input)
      child.stdin.end(input)
    else
      child.stdin.end()
  })
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
