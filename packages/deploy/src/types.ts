import type { ClientOptions } from 'cloudflare'
import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface'
import type { GetFunctionRequest, ImageConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/services/scf/v20180416/scf_models'
import type { DescribeImagePersonalRequest } from 'tencentcloud-sdk-nodejs/tencentcloud/services/tcr/v20190924/tcr_models'

export interface BaseDeployConfig {
  /**
   * deploy type
   * More deploy types can be added in the future
   *
   * @see https://github.com/cloudflare/cloudflare-typescript#request--response-types
   * - cloudflare-pages 需要配置 CLOUDFLARE_EMAIL 和 CLOUDFLARE_API_KEY
   * - tencent-scf [腾讯云 SCF 云函数](https://console.cloud.tencent.com/scf/list)
   */
  type: 'cloudflare-pages' | 'tencent-scf'
  /**
   * 部署超时
   * 默认 600s
   * @default 600s
   */
  timeout?: number
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
   * docker
   */
  docker?: {
    /**
     * 是否本地构建
     */
    local?: boolean
    /**
     * 构建检测超时时间
     * 默认 500s
     * 单位 ms
     */
    timeout?: number
    /**
     * 检查构建是否完成的间隔
     * 默认 5s
     * 单位 ms
     */
    interval?: number
  }

  /**
   * 通知
   */
  notification?: {
    /**
     * 飞书通知
     */
    feishu?: {
      enable: boolean
      /**
       * 飞书 webhook 地址
       * 可被环境变量 FEISHU_NOTIFICATION_WEBHOOK_URL 覆盖
       */
      webhookUrl?: string
    }
  }
  /**
   * 部署完成后的回调
   */
  onDeployed?: () => void | Promise<void>
  /**
   * 部署失败的回调
   */
  onFailed?: (error: Error) => void | Promise<void>
}

export interface CloudflarePagesDeployConfig extends BaseDeployConfig {
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
}

export interface TencentDeployConfig extends BaseDeployConfig {
  type: 'tencent-scf'
  /**
   * 腾讯云配置
   */
  tencent: {
    /**
     * client config
     * region @default ap-shanghai
     * credential 默认读取环境变量 TENCENT_CLOUD_SECRET_ID 和 TENCENT_CLOUD_SECRET_KEY
     */
    client: ClientConfig

    /**
     * SCF 配置
     * 云函数
     */
    scf: {
      /**
       * string
       * 容器的启动参数。该参数为可选参数，如果不填写，则默认使用 Dockerfile 中的 CMD。传入规范，以“空格”作为参数的分割标识，例如 -u app.py
       */
      args?: string
      /**
       * 函数名
       */
      function: GetFunctionRequest
      alias: {
        /**
         * 别名名称
         * 发布版本后，会将此别名的所属流量切换到最新版本上
         */
        name?: string
      }

      /**
       * - ImageType 类型
       *   - personal 个人版
       *   - enterprise 企业版（付费）
       * - ContainerImageAccelerate 是否使用容器镜像加速服务
       */
      ImageConfig: Partial<ImageConfig>
    }

    /**
     * Tencent Cloud Registry
     */
    tcr: {
      /**
       * region
       * @default ap-shanghai
       */
      region?: string
      /**
       * TCR 凭据
       * @default TENCENT_CLOUD_TCR_TOKEN
       */
      token?: string
      /**
       * repo name
       */
      image: DescribeImagePersonalRequest
    }
  }
}

export type DeployConfig = CloudflarePagesDeployConfig | TencentDeployConfig
