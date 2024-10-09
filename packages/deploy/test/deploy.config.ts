import consola from 'consola'
import { defineConfig } from '../src'

const yyjAccountId = 'ecac80638e001ece1b79584ffef5e65a'
const ylfAccountId = '1c4b352e9e5f7d5655da259e1404ca80'

const accountId = {
  yyj: yyjAccountId,
  ylf: ylfAccountId,
}

export default defineConfig({
  type: 'cloudflare-pages',
  cdn: {
    enable: true,
    type: 'teo',
  },
  cloudflare: {
    accountId: accountId.ylf,
    // projectName: 'admin',
    projectName: 'tools',
  },

  notification: {
    feishu: {
      enable: true,
    },
  },

  onDeployed: async () => {
    consola.success('部署完成')
  },
})
