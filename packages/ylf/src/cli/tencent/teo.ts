import type { CreatePurgeTaskRequest } from 'tencentcloud-sdk-nodejs/tencentcloud/services/teo/v20220901/teo_models'
import consola from 'consola'
import { colors } from 'consola/utils'
import * as tencentcloud from 'tencentcloud-sdk-nodejs'
import { lineStart } from '../common'
import { createTencentClientConfig } from './config'
import { submitEdgeOnePurgeTask } from './teo-purge'

const TEOClient = tencentcloud.teo.v20220901.Client
let teoClient: InstanceType<typeof TEOClient> | undefined

function getTEOClient() {
  teoClient ??= new TEOClient(createTencentClientConfig())
  return teoClient
}

/**
 * 获取站点列表
 */
export async function getTEOZoneList() {
  const data = await getTEOClient().DescribeZones({})
  return data.Zones?.map((zone) => {
    return {
      label: zone.ZoneName || 'unknown',
      value: zone.ZoneId || 'unknown',
      hint: zone.AliasZoneName,
    }
  })
}

/**
 * 获取站点 DNS 列表
 * @param zoneId
 */
export async function getTEOZoneDnsList(zoneId: string) {
  const data = await getTEOClient().DescribeAccelerationDomains({
    ZoneId: zoneId,
  })
  return data
    .AccelerationDomains
    ?.filter(domain => domain.DomainStatus === 'online')
    .map((domain) => {
      const hint = [
        domain.IPv6Status === 'on' ? 'IPv6' : 'IPv4',
        `SSL: ${domain.Certificate?.Mode}`,
      ].join(' | ')

      return {
        label: domain.DomainName || 'unknown',
        value: domain.DomainName || 'unknown',
        hint,
      }
    })
}

export async function runTEOTask(
  createPurgeTaskRequest: CreatePurgeTaskRequest,
  options: { json?: boolean } = {},
) {
  if (!options.json) {
    console.log()
    consola.start('☁️ EdgeOne 提交缓存刷新任务')
    // consola.box 中文对齐有问题
    const targets = createPurgeTaskRequest.Targets || []
    console.info(lineStart, colors.dim('站点 ID :'), colors.cyan(createPurgeTaskRequest.ZoneId))
    console.info(lineStart, colors.dim('刷新类型:'), colors.cyan(createPurgeTaskRequest.Type))
    console.info(lineStart, colors.dim('刷新目标:'), targets.map(target => colors.cyan(target)).join(', ') || colors.dim('全部缓存'))
  }

  const result = await submitEdgeOnePurgeTask(createPurgeTaskRequest, getTEOClient())
  if (options.json) {
    console.log(JSON.stringify(result))
  }
  else {
    consola.success(`☁️ EdgeOne 刷新任务已提交：${result.jobId}`)
    if (result.requestId)
      console.info(lineStart, colors.dim('Request ID:'), colors.cyan(result.requestId))
    console.log()
  }
  return result
}
