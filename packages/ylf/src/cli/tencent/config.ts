import type { TencentClientConfig } from '../../../../tencent-cloud/config'
import process from 'node:process'

export const clientConfig: TencentClientConfig = {
  region: 'ap-shanghai',
  credential: {
    secretId: process.env.TENCENT_CLOUD_SECRET_ID,
    secretKey: process.env.TENCENT_CLOUD_SECRET_KEY,
  },
}
