import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface'
import process from 'node:process'

export type TencentClientConfig = ClientConfig

/**
 * 腾讯云 Client 默认配置
 */
export const defaultTencentClientConfig: TencentClientConfig = {
  region: 'ap-shanghai',
  credential: {
    secretId: process.env.TENCENT_CLOUD_SECRET_ID,
    secretKey: process.env.TENCENT_CLOUD_SECRET_KEY,
  },
}
