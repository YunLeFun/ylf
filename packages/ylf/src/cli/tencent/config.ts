import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface'
import process from 'node:process'

export const clientConfig: ClientConfig = {
  region: 'ap-shanghai',
  credential: {
    secretId: process.env.TENCENT_CLOUD_SECRET_ID,
    secretKey: process.env.TENCENT_CLOUD_SECRET_KEY,
  },
}
