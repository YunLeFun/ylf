import type { Stage } from 'cloudflare/resources/pages/projects/projects.mjs'
import type { DeployConfig } from './types'
import Cloudflare, { type ClientOptions } from 'cloudflare'
import consola from 'consola'
import { colors } from 'consola/utils'

import { formatDate } from 'date-fns'
import { consoleInfo, errorStart } from '../../shared'
import { sleep } from '../../shared/utils'
import { sendFeishuMessageByWebhook } from './feishu'

export function initCloudflareClient(config: ClientOptions) {
  const cloudflare = new Cloudflare({
    ...config,
  })
  return cloudflare
}

/**
 * 检查 Cloudflare Pages 部署状态
 */
export async function checkCFPagesDeployStatus(config: DeployConfig) {
  const cfConfig = config?.cloudflare
  const client = initCloudflareClient(cfConfig?.client || {})
  // await client.accounts.list({
  //   name: 'me@yunyoujun.cn'
  // })

  if (!cfConfig?.accountId) {
    consola.error('请设置 Cloudflare Pages 账户 ID')
    return
  }

  const project = await client.pages.projects.get(cfConfig.projectName, {
    account_id: cfConfig?.accountId,
  })
  const latestDeployment = project.latest_deployment
  const isSkipped = project.latest_deployment?.is_skipped

  let loop = true

  // 跳过
  if (isSkipped) {
    loop = false
    consola.warn('部署已跳过')
    consola.info(`ID: ${latestDeployment?.id}`)
    consola.info(`URL: ${latestDeployment?.url}`)
    return
  }

  consola.start('查询部署状态')
  const latestStage = latestDeployment?.latest_stage as Stage
  const startedOn = latestStage.started_on ? formatDate(latestStage.started_on, 'yyyy-MM-dd HH:mm:ss') : ''
  consoleInfo({
    '当前阶段:': colors.yellow(latestStage.name || ''),
    '开始时间:': colors.cyan(startedOn),
    // '部署状态:': latestStage.status === 'success' ? '✅' : latestStage.status,
    // '部署状态:': status,
  })

  switch (latestStage.status) {
    // 失败
    case 'failed':
    case 'failure': {
      loop = false
      console.log(errorStart, '执行失败')
      await config.onFailed?.(new Error('部署失败'))
      break
    }
    // 成功
    case 'success': {
      consola.success('执行成功')
      if (latestStage.name === 'deploy') {
        loop = false
        console.log()
        consola.success('部署完成')
      }
      await config.onDeployed?.()
      break
    }
  }

  if (loop) {
    // sleep 5s
    console.log()
    await sleep(5000)
    // 轮询
    return await checkCFPagesDeployStatus(config)
  }
  else {
    return latestDeployment
  }
}

/**
 * 部署到 Cloudflare Pages 的相关逻辑
 * 譬如检测部署状态、执行部署完成的逻辑
 */
export async function cfPagesDeploy(config: DeployConfig) {
  const deployment = await checkCFPagesDeployStatus(config)
  // send feishu message
  if (config.notification?.feishu?.enable) {
    const latestStage = deployment?.latest_stage as Stage
    let status = ''
    switch (latestStage.status) {
      case 'success':
        status = '✅'
        break
      case 'failed':
      case 'failure':
        status = '❌'
        break
      default:
        status = latestStage.status || ''
    }
    const source = deployment?.source as {
      type: string
      config: {
        owner: string
        repo_name: string
        production_branch: string
        pr_comments_enabled: boolean
      }
    }
    const githubUrl = source?.type === 'github' ? `https://github.com/${source?.config.owner}/${source?.config.repo_name}` : ''
    const commitHash = deployment?.deployment_trigger?.metadata?.commit_hash?.slice(0, 7)
    const commitUrl = `${githubUrl}/commit/${deployment?.deployment_trigger?.metadata?.commit_hash}`
    const content = `**项目名称**: ${deployment?.project_name}
**触发方式**: ${deployment?.deployment_trigger?.type}
**构建分支**: ${deployment?.deployment_trigger?.metadata?.branch}
**变更信息**: ${deployment?.deployment_trigger?.metadata?.commit_message} [(${commitHash})](${commitUrl})
**部署环境**: ${deployment?.environment}
**完成时间**: ${latestStage.ended_on ? formatDate(latestStage.ended_on, 'yyyy-MM-dd HH:mm:ss') : ''}
`
    const deploymentLogUrl = `https://dash.cloudflare.com/${config.cloudflare?.accountId}/pages/view/${deployment?.project_name}/${deployment?.id}`

    // sendFeishuMessage()
    sendFeishuMessageByWebhook({
      webhook_url: config.notification.feishu.webhookUrl,
      msg: {
        msg_type: 'interactive',
        card: {
          header: {
            title: {
              content: `Cloudflare Pages 部署状态 ${status}`,
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
                    content: '预览地址',
                    tag: 'lark_md',
                  },
                  url: deployment?.url,
                  type: 'primary',
                  value: {},
                },
                {
                  tag: 'button',
                  text: {
                    content: '部署日志',
                    tag: 'lark_md',
                  },
                  url: deploymentLogUrl,
                  type: 'default',
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
