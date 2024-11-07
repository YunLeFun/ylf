import type { TagInfo } from 'tencentcloud-sdk-nodejs/tencentcloud/services/tcr/v20190924/tcr_models'
import type { TencentDeployConfig } from '../types'
import consola from 'consola'
import { sendFeishuMessageByWebhook, type SendFeishuMessageOptions } from '../feishu'
import { getConsoleTCRUrl } from './tcr'

export class TencentNotification {
  config: TencentDeployConfig

  /**
   * 函数名
   */
  functionName: string
  /**
   * 命名空间
   */
  namespace: string
  /**
   * SCF 名称 = 命名空间/函数名
   */
  scfName: string

  constructor(config: TencentDeployConfig) {
    this.functionName = config.tencent.scf.function.FunctionName || ''
    this.namespace = config.tencent.scf.function.Namespace || ''
    this.scfName = this.namespace ? `${this.namespace}/${this.functionName}` : this.functionName

    this.config = config as TencentDeployConfig & {
      notification: {
        feishu: {
          webhookUrl: string
        }
      }
    }
  }

  /**
   * 发送飞书消息
   */
  async sendFeishuMessage(options: Omit<SendFeishuMessageOptions, 'webhook_url'>) {
    try {
      await sendFeishuMessageByWebhook({
        webhook_url: this.config.notification?.feishu?.webhookUrl,
        ...options,
      })
    }
    catch (error) {
      consola.error('飞书消息推送失败')
      console.error(error)
    }
  }

  /**
   * 发送开始通知
   */
  async sendStartMsg() {
    const { config } = this

    const content = `**镜像仓库**: ${config.tencent.tcr.image.RepoName}
`
    await this.sendFeishuMessage({
      msg: {
        msg_type: 'interactive',
        card: {
          header: {
            title: {
              content: `腾讯云函数 ${this.scfName} 开始部署...`,
              tag: 'plain_text',
            },
          },
          elements: [
            {
              tag: 'markdown',
              content,
            },

            {
              tag: 'action',
              actions: [
                {
                  tag: 'button',
                  text: {
                    content: '函数服务 - 腾讯云控制台',
                    tag: 'lark_md',
                  },
                  url: `https://console.cloud.tencent.com/scf/list?ns=${config.tencent.scf.function.Namespace}`,
                  type: 'primary',
                  value: {},
                },
              ],
            },
          ],
        },
      },
    })
  }

  /**
   * 发送部署过程中的通知
   */
  async sendDeployMsg(options: {
    /**
     * 描述
     */
    Description: string
  }) {
    const { Description } = options
    const { scfName } = this

    await this.sendFeishuMessage({
      msg: {
        msg_type: 'interactive',
        card: {
          header: {
            title: {
              content: `腾讯云函数 ${scfName} 部署完成`,
              tag: 'plain_text',
            },
          },
          elements: [
            {
              tag: 'markdown',
              content: `**发布版本**: ${Description}`,
            },
          ],
        },
      },
    })
  }

  /**
   * 发送完整通知
   */
  async sendFullMsg(options: {
    functionVersion: string
    latestTagInfo?: TagInfo
  }) {
    const { config } = this
    const { functionVersion, latestTagInfo } = options

    if (!latestTagInfo) {
      consola.warn('未获取到镜像信息，无法发送完整通知')
      return
    }

    const fullMsg = `**当前版本**: ${functionVersion}
**镜像标签**: [${latestTagInfo.TagName}](${getConsoleTCRUrl(config.tencent.tcr.image.RepoName)})
**镜像大小**: ${latestTagInfo.Size} (${latestTagInfo.Architecture})
**更新时间**: ${latestTagInfo.UpdateTime}
  `
    await this.sendFeishuMessage({
      msg: {
        msg_type: 'interactive',
        card: {
          header: {
            title: {
              content: `腾讯云函数 ${this.scfName} 部署成功 ✅`,
              tag: 'plain_text',
            },
          },
          elements: [
            {
              tag: 'markdown',
              content: fullMsg,
            },
            {
              tag: 'action',
              actions: [
                {
                  tag: 'button',
                  text: {
                    content: '函数服务 - 腾讯云控制台',
                    tag: 'lark_md',
                  },
                  url: `https://console.cloud.tencent.com/scf/list?ns=${config.tencent.scf.function.Namespace}`,
                  type: 'primary',
                  value: {},
                },
              ],
            },
          ],
        },
      },
    })
  }
}
