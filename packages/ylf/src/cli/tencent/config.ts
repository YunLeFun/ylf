import type { TencentClientConfig } from '../../../../tencent-cloud/config'
import process from 'node:process'

interface TencentCloudCredentialEnvironment {
  [key: string]: string | undefined
  TENCENT_CLOUD_SECRET_ID?: string
  TENCENT_CLOUD_SECRET_KEY?: string
}

export function createTencentClientConfig(
  env: TencentCloudCredentialEnvironment = process.env,
): TencentClientConfig {
  const secretId = env.TENCENT_CLOUD_SECRET_ID?.trim()
  const secretKey = env.TENCENT_CLOUD_SECRET_KEY?.trim()
  if (!secretId)
    throw new Error('缺少 TENCENT_CLOUD_SECRET_ID')
  if (!secretKey)
    throw new Error('缺少 TENCENT_CLOUD_SECRET_KEY')
  return {
    region: 'ap-shanghai',
    credential: { secretId, secretKey },
  }
}
