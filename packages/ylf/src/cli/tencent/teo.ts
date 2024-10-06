import type { CreatePurgeTaskRequest } from 'tencentcloud-sdk-nodejs/tencentcloud/services/teo/v20220901/teo_models'
import consola from 'consola'
import { colors } from 'consola/utils'
import * as tencentcloud from 'tencentcloud-sdk-nodejs'
import { lineStart } from '../common'
import { clientConfig } from './config'

const TEOClient = tencentcloud.teo.v20220901.Client
const teoClient = new TEOClient(clientConfig)

/**
 * 获取站点列表
 */
export async function getTEOZoneList() {
  const data = await teoClient.DescribeZones({})
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
  const data = await teoClient.DescribeAccelerationDomains({
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

export async function runTEOTask(createPurgeTaskRequest: CreatePurgeTaskRequest) {
  console.log()
  consola.start('☁️ EdgeOne 提交缓存刷新任务')
  // consola.box 中文对齐有问题
  const targets = createPurgeTaskRequest.Targets || []
  console.info(lineStart, colors.dim('站点 ID :'), colors.cyan(createPurgeTaskRequest.ZoneId || 'unknown'))
  console.info(lineStart, colors.dim('刷新类型:'), colors.cyan(createPurgeTaskRequest.Type))
  console.info(lineStart, colors.dim('刷新目标:'), targets.map(target => colors.cyan(target)).join(', '))

  const result = await teoClient.CreatePurgeTask(createPurgeTaskRequest)
  consola.success('☁️ EdgeOne 提交缓存刷新任务')
  console.dir(result)
  console.log()
}
