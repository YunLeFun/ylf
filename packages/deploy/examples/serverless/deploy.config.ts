import process from 'node:process'
import consola from 'consola'
import { defineConfig } from '../../src'

export default defineConfig({
  type: 'tencent-scf',

  // cdn: {
  //   enable: true,
  //   type: 'teo',
  // },

  tencent: {
    client: {
      region: 'ap-shanghai',
      credential: {
        secretId: process.env.TENCENT_CLOUD_SECRET_ID,
        secretKey: process.env.TENCENT_CLOUD_SECRET_KEY,
      },
    },
    scf: {
      alias: {
        name: '$DEFAULT',
      },
      function: {
        Namespace: 'YunLeFun',
        FunctionName: 'test',
      },
      ImageConfig: {
        ImageType: 'personal',
        ContainerImageAccelerate: false,
      },
    },
    tcr: {
      region: 'ap-guangzhou',
      token: process.env.TENCENT_CLOUD_TCR_TOKEN,
      image: {
        RepoName: 'yunlefun/ylf-test',
      },
    },
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
