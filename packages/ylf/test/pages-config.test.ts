import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findPagesConfig,
  initializePagesConfig,
  PAGES_CONFIG_FILENAME,
  PAGES_SCHEMA_URL,
  parsePagesConfig,
  resolvePagesConfig,
} from '../src/pages/config'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ylf-pages-config-'))
  cleanup.push(directory)
  return directory
}

describe('ylf.pages.json', () => {
  it('writes the minimal version-pinned project mapping without access policy', async () => {
    const directory = await temporaryDirectory()
    const result = await initializePagesConfig({
      directory,
      workspace: 'yunlefun',
      project: 'pages-smoke',
      output: 'dist',
    })
    expect(result.config).toEqual({
      $schema: PAGES_SCHEMA_URL,
      workspace: 'yunlefun',
      project: 'pages-smoke',
      output: 'dist',
    })
    expect(JSON.parse(await readFile(result.configPath, 'utf8'))).toEqual(result.config)
    await expect(initializePagesConfig({
      directory,
      workspace: 'yunlefun',
      project: 'other-project',
      output: 'dist',
    })).rejects.toThrow(/已存在/)
  })

  it('rejects visibility, members, reserved slugs, and output traversal', () => {
    expect(() => parsePagesConfig({
      workspace: 'yunlefun',
      project: 'pages-smoke',
      output: 'dist',
      visibility: 'public',
    })).toThrow(/未知字段.*visibility/)
    expect(() => parsePagesConfig({
      workspace: 'yunlefun',
      project: 'api',
      output: 'dist',
    })).toThrow(/保留名称/)
    expect(() => parsePagesConfig({
      workspace: 'yunlefun',
      project: 'pages-smoke',
      output: '../secret',
    })).toThrow(/不能离开/)
  })

  it('finds the nearest config and resolves output relative to it', async () => {
    const directory = await temporaryDirectory()
    const nested = path.join(directory, 'packages', 'demo')
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(directory, PAGES_CONFIG_FILENAME), JSON.stringify({
      workspace: 'yunlefun',
      project: 'pages-smoke',
      output: 'site/dist',
    }))
    expect(await findPagesConfig(nested)).toBe(path.join(directory, PAGES_CONFIG_FILENAME))
    await expect(resolvePagesConfig({ cwd: nested })).resolves.toMatchObject({
      workspace: 'yunlefun',
      project: 'pages-smoke',
      outputDirectory: path.join(directory, 'site', 'dist'),
    })
  })

  it('supports a direct directory only when workspace and project are also explicit', async () => {
    const directory = await temporaryDirectory()
    await expect(resolvePagesConfig({ cwd: directory })).rejects.toThrow(/pages init/)
    await expect(resolvePagesConfig({
      cwd: directory,
      overrides: {
        workspace: 'yunlefun',
        project: 'pages-smoke',
        output: './public',
      },
    })).resolves.toMatchObject({
      configPath: null,
      outputDirectory: path.join(directory, 'public'),
    })
  })
})
