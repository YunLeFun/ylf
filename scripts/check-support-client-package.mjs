import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageName = '@yunlefun/support-client'
const registry = 'https://registry.npmjs.org'
const args = process.argv.slice(2)
const registryMode = args[0] === '--registry'
const input = registryMode ? args[1] : args[0]
if (!input || args.length !== (registryMode ? 2 : 1))
  throw new Error('Usage: node scripts/check-support-client-package.mjs <tarball> | --registry <version>')

async function bytes(response, maximum) {
  assert(response.ok, `Registry returned HTTP ${response.status}`)
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done)
        break
      size += next.value.byteLength
      assert(size <= maximum, 'Registry response exceeds package size limit')
      chunks.push(next.value)
    }
    return Buffer.concat(chunks)
  }
  finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

async function download(version, target) {
  assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version), 'Invalid SDK version')
  let metadata
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`${registry}/${encodeURIComponent(packageName)}/${version}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if ([404, 429, 502, 503].includes(response.status) && attempt < 5) {
      await response.body?.cancel()
      await setTimeout(2_000 * (attempt + 1))
      continue
    }
    metadata = JSON.parse((await bytes(response, 262_144)).toString('utf8'))
    break
  }
  assert.equal(metadata.name, packageName)
  assert.equal(metadata.version, version)
  const tarball = new URL(metadata.dist.tarball)
  assert.equal(tarball.origin, registry)
  assert(!tarball.username && !tarball.password && !tarball.search && !tarball.hash)
  assert(tarball.pathname.startsWith('/@yunlefun/support-client/-/'))
  assert(/^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist.integrity))
  const content = await bytes(await fetch(tarball, { redirect: 'error', signal: AbortSignal.timeout(20_000) }), 1_048_576)
  assert.equal(`sha512-${createHash('sha512').update(content).digest('base64')}`, metadata.dist.integrity)
  await writeFile(target, content)
  return version
}

const temporary = await mkdtemp(join(tmpdir(), 'support-sdk-package-'))
try {
  const tarball = registryMode ? join(temporary, 'package.tgz') : resolve(input)
  const version = registryMode ? await download(input, tarball) : undefined
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
  for (const entry of entries) {
    assert(!entry.split('/').includes('..'), 'Unsafe archive path')
    assert(['package/package.json', 'package/README.md', 'package/LICENSE'].includes(entry)
      || /^package\/dist\/[\w./-]+\.(?:mjs|d\.mts)$/.test(entry), `Unexpected package file: ${entry}`)
  }
  const modes = execFileSync('tar', ['-tvzf', tarball], { encoding: 'utf8' }).trim().split('\n')
  assert(modes.every(line => line.startsWith('-')), 'Package must contain only regular files')
  const metadata = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }))
  assert.equal(metadata.name, packageName)
  const sourceMetadata = JSON.parse(await readFile(join(root, 'packages/support-client/package.json'), 'utf8'))
  assert.equal(metadata.version, version ?? sourceMetadata.version)
  assert.equal(metadata.license, 'MIT')
  assert.equal(metadata.repository.url, 'git+https://github.com/YunLeFun/ylf.git')
  assert.equal(metadata.repository.directory, 'packages/support-client')
  assert.equal(metadata.publishConfig.access, 'public')
  assert.equal(metadata.publishConfig.registry, `${registry}/`)
  assert(!metadata.private && !metadata.dependencies && !metadata.optionalDependencies)
  for (const entry of ['index', 'server', 'feishu']) {
    assert(entries.includes(`package/dist/${entry}.mjs`))
    assert(entries.includes(`package/dist/${entry}.d.mts`))
  }
  assert(entries.includes('package/LICENSE'))
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: 'support-sdk-install-check', private: true, type: 'module' }))
  const userconfig = join(temporary, 'empty.npmrc')
  await writeFile(userconfig, `registry=${registry}/\n`)
  execFileSync('npm', ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `--userconfig=${userconfig}`], { cwd: temporary, stdio: 'pipe' })
  for (const [source, destination] of [['package-smoke.mjs', 'smoke.mjs'], ['package-types.mts', 'types.mts']])
    await copyFile(join(root, 'packages/support-client/test', source), join(temporary, destination))
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: temporary, stdio: 'inherit' })
  const require = createRequire(join(root, 'packages/support-client/package.json'))
  const nodeTypes = dirname(dirname(require.resolve('@types/node/package.json')))
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), 'types.mts', '--noEmit', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--strict', '--skipLibCheck', '--typeRoots', nodeTypes, '--types', 'node'], { cwd: temporary, stdio: 'inherit' })
  console.log(JSON.stringify({ name: metadata.name, version: metadata.version, source: registryMode ? 'npm registry' : 'local tarball', files: entries.length, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex'), verified: true }))
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
