import process from 'node:process'
import consola from 'consola'
import { defineConfig } from '../../src'

export default defineConfig({
  type: 'cloudflare-pages',
  cdn: {
    enable: true,
    type: 'teo',
  },
  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || 'your-cloudflare-account-id',
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
