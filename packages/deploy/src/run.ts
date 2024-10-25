import type { DeployConfig } from './types'
import { loadConfig } from 'c12'
import consola from 'consola'
import { colors } from 'consola/utils'

/**
 * run
 */
export async function run() {
  consola.debug('加载本地配置文件', colors.cyan('deploy.config.ts'))

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
