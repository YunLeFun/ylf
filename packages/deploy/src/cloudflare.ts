import type { Stage } from 'cloudflare/resources/pages/projects/projects.mjs'
import type { DeployConfig } from './types'
import Cloudflare, { type ClientOptions } from 'cloudflare'
import consola from 'consola'
import { formatDate } from 'date-fns'

import { consoleInfo } from '../../shared'

export function initCloudflareClient(config: ClientOptions) {
  const cloudflare = new Cloudflare({
    ...config,
  })
  return cloudflare
}

/**
 * 检查 Cloudflare Pages 部署状态
 */
export async function checkCFPagesDeployStatus(config: DeployConfig['cloudflare']) {
  const client = initCloudflareClient(config?.client || {})
  // await client.accounts.list({
  //   name: 'me@yunyoujun.cn'
  // })

  if (!config?.accountId) {
    consola.error('请设置 Cloudflare Pages 账户 ID')
    return
  }

  const project = await client.pages.projects.get(config.projectName, {
    account_id: config?.accountId,
  })
  const latestDeployment = project.latest_deployment
  const isSkipped = project.latest_deployment?.is_skipped

  if (isSkipped) {
    consola.warn('部署已跳过')
    consola.info(`ID: ${latestDeployment?.id}`)
    consola.info(`URL: ${latestDeployment?.url}`)
  }

  consola.start('查询部署状态')
  const latestStage = latestDeployment?.latest_stage as Stage
  const status = latestStage.status === 'success' ? '✅' : latestStage.status
  consoleInfo({
    'Stage:': latestStage.name,
    '开始时间:': latestStage.started_on ? formatDate(latestStage.started_on, 'yyyy-MM-dd HH:mm:ss') : '',
    // '部署状态:': latestStage.status === 'success' ? '✅' : latestStage.status,
    '部署状态:': status,
  })
  consola.success('查询完毕')
  console.log()
}
