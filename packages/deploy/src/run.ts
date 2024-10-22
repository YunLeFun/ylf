import type { DeployConfig } from './types'
import { loadConfig, watchConfig } from 'c12'

/**
 * run
 */
export async function run() {
  const { config } = await loadConfig<DeployConfig>({
    configFile: 'deploy.config',
  })

  switch (config.type) {
    case 'cloudflare-pages': {
      const { deployCfPages } = await import('./cloudflare')
      await deployCfPages(config)
      break
    }
    case 'tencent-scf': {
      const { deployTencentSCF } = await import('./tencent')
      await deployTencentSCF(config)
      break
    }
    default:
      break
  }
}
