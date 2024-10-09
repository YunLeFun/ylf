import type { ClientOptions } from 'cloudflare'

export interface DeployConfig {
  /**
   * deploy type
   * More deploy types can be added in the future
   *
   * @see https://github.com/cloudflare/cloudflare-typescript#request--response-types
   * - cloudflare-pages 需要配置 CLOUDFLARE_EMAIL 和 CLOUDFLARE_API_KEY
   */
  type: 'cloudflare-pages'
  /**
   * cloudflare
   * 若不配置，会默认从环境变量中读取 CLOUDFLARE_EMAIL 和 CLOUDFLARE_API_KEY
   * 环境变量优先级高于配置
   *
   * @see 配置令牌 https://dash.cloudflare.com/profile/api-tokens
   */
  cloudflare?: {
    accountId: string
    projectName: string
    client?: ClientOptions
  }
  /**
   * cdn
   */
  cdn?: {
    /**
     * 是否启用 CDN
     * 将会在部署完后触发 CDN 缓存刷新
     */
    enable: boolean
    /**
     * - teo: Tencent EdgeOne
     */
    type: 'teo'
  }
  /**
   * 部署完成后的回调
   */
  onDeployed?: () => void | Promise<void>
}
