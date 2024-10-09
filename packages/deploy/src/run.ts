import type { DeployConfig } from './types'
import { loadConfig, watchConfig } from 'c12'

/**
 * run
 */
export async function run() {
  const { config } = await loadConfig<DeployConfig>({
    configFile: 'deploy.config',
  })

  if (config.type === 'cloudflare-pages') {
    const { checkCFPagesDeployStatus } = await import('./cloudflare')
    await checkCFPagesDeployStatus(config.cloudflare)
  }
}
