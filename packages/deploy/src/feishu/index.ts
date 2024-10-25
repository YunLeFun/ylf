import type * as lark from '@larksuiteoapi/node-sdk'
import process from 'node:process'
import axios from 'axios'

import consola from 'consola'
import { colors } from 'consola/utils'

export interface SendFeishuMessageOptions {
  webhook_url?: string
  msg: {
    msg_type: 'interactive'
    card: lark.InteractiveCard
  }
}

/**
 * @see [自定义机器人使用指南-飞书](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)
 */
export async function sendFeishuMessageByWebhook(options: SendFeishuMessageOptions) {
  console.log()
  consola.start('💬 推送飞书消息')
  const webhookUrl = process.env.FEISHU_NOTIFICATION_WEBHOOK_URL || options.webhook_url
  if (!webhookUrl) {
    consola.warn('请设置飞书 webhook 地址，' + `可参考：${colors.underline('https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot')}`)
    return
  }

  // TODO
  await axios.post(webhookUrl, options.msg)
  consola.success('💬 消息推送成功')
}
