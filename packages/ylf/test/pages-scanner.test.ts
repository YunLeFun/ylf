import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cacheControlForPagesPath,
  orderPagesUploads,
  scanPagesDirectory,
} from '../src/pages/scanner'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function temporarySite() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ylf-pages-site-'))
  cleanup.push(directory)
  return directory
}

describe('pages directory scanner', () => {
  it('hashes a safe static site and assigns stable cache metadata', async () => {
    const directory = await temporarySite()
    await mkdir(path.join(directory, 'assets'))
    await writeFile(path.join(directory, 'index.html'), '<h1>hello</h1>')
    await writeFile(path.join(directory, 'about.html'), '<h1>about</h1>')
    await writeFile(path.join(directory, 'assets', 'app.a1b2c3d4.js'), 'console.log(1)')

    const result = await scanPagesDirectory({ directory })
    expect(result.fileCount).toBe(3)
    expect(result.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
    expect(result.files.find(file => file.path.endsWith('.js'))?.cacheControl)
      .toBe('public, max-age=31536000, immutable')
    expect(result.files.find(file => file.path === 'index.html')?.contentType)
      .toMatch(/^text\/html/)
    expect(orderPagesUploads(result.files).map(file => file.path)).toEqual([
      'assets/app.a1b2c3d4.js',
      'about.html',
      'index.html',
    ])
  })

  it('blocks secrets and private keys before deployment', async () => {
    for (const relativePath of ['.env', '.env.production', '.npmrc', 'id_rsa', 'certs/site.pem']) {
      const directory = await temporarySite()
      await writeFile(path.join(directory, 'index.html'), 'ok')
      const target = path.join(directory, relativePath)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, 'secret')
      await expect(scanPagesDirectory({ directory })).rejects.toThrow(/敏感文件|私钥文件/)
    }
  })

  it('blocks dependency/reserved directories and symbolic links', async () => {
    const dependencySite = await temporarySite()
    await writeFile(path.join(dependencySite, 'index.html'), 'ok')
    await mkdir(path.join(dependencySite, 'node_modules'))
    await writeFile(path.join(dependencySite, 'node_modules', 'oops.js'), 'bad')
    await expect(scanPagesDirectory({ directory: dependencySite })).rejects.toThrow(/node_modules/)

    const symlinkSite = await temporarySite()
    await writeFile(path.join(symlinkSite, 'index.html'), 'ok')
    await symlink(path.join(symlinkSite, 'index.html'), path.join(symlinkSite, 'linked.html'))
    await expect(scanPagesDirectory({ directory: symlinkSite })).rejects.toThrow(/符号链接/)
  })

  it('enforces file count, total size, single-file size, and index requirements', async () => {
    const directory = await temporarySite()
    await writeFile(path.join(directory, 'index.html'), '1234')
    await writeFile(path.join(directory, 'extra.txt'), '12')
    await expect(scanPagesDirectory({
      directory,
      quota: { maxFiles: 1, maxTotalBytes: 100, maxFileBytes: 100 },
    })).rejects.toThrow(/文件数量/)
    await expect(scanPagesDirectory({
      directory,
      quota: { maxFiles: 10, maxTotalBytes: 5, maxFileBytes: 5 },
    })).rejects.toThrow(/部署总大小/)
    await expect(scanPagesDirectory({
      directory,
      quota: { maxFiles: 10, maxTotalBytes: 100, maxFileBytes: 3 },
    })).rejects.toThrow(/单文件/)

    const assetDirectory = await temporarySite()
    await writeFile(path.join(assetDirectory, 'app.js'), 'ok')
    await expect(scanPagesDirectory({ directory: assetDirectory })).rejects.toThrow(/index.html/)
    await expect(scanPagesDirectory({ directory: assetDirectory, allowNoIndex: true })).resolves.toBeDefined()
  })

  it('keeps HTML revalidated and unhashed resources short-lived', () => {
    expect(cacheControlForPagesPath('index.html')).toBe('public, max-age=0, must-revalidate')
    expect(cacheControlForPagesPath('assets/app.js')).toBe('public, max-age=3600')
  })
})
