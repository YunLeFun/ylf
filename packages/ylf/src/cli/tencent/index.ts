// tencent cloud

import type { CreatePurgeTaskRequest } from 'tencentcloud-sdk-nodejs/tencentcloud/services/teo/v20220901/teo_models'
import type { Argv } from 'yargs'

import consola from 'consola'
import { colors } from 'consola/utils'
import { clearSCFVersionsByArgv } from './scf'
import { getTEOZoneDnsList, getTEOZoneList, runTEOTask } from './teo'

/**
 * default config
 * @todo allow user custom
 */
const createPurgeTaskRequest: CreatePurgeTaskRequest = {
  ZoneId: '',
  // - purge_url：URL刷新；
  // - purge_prefix：目录刷新；
  // - purge_host：Hostname 刷新；
  // - purge_all：站点下全部缓存刷新；
  // - purge_cache_tag：cache-tag 刷新。缓存清除类型详情请查看[清除缓存](https://cloud.tencent.com/document/product/1552/70759)。
  Type: 'purge_host',
  Targets: [],
}

/**
 * tencent cloud
 * @see [腾讯云命令行工具 TCCLI](https://cloud.tencent.com/document/product/440/6176)
 * @see tencentcloud-sdk-nodejs
 * @see [Tencent Cloud SDK for Node.js](https://github.com/TencentCloud/tencentcloud-sdk-nodejs)
 * @see [Node.js 帮助文档](https://cloud.tencent.com/document/sdk/Node.js)
 * @see [API Explorer](https://console.cloud.tencent.com/api/explorer)
 */
export async function registerTencentCloudCommand(args: Argv) {
  args.command(
    'tc',
    '腾讯云 基于腾讯云 NodeJS SDK',
    (args) => {
      return args.command(
        'teo',
        `EdgeOne ${colors.dim('https://console.cloud.tencent.com/edgeone')}`,
        () => {
          return args.command('purge', '提交缓存刷新任务', () => {
            return args
              .option('zoneId', {
                alias: 'z',
                type: 'string',
                description: '站点 id',
                // demandOption: true,
              })
              .option('type', {
                alias: 't',
                type: 'string',
                description: '刷新类型',
                choices: ['purge_url', 'purge_prefix', 'purge_host', 'purge_all', 'purge_cache_tag'],
                demandOption: true,
                default: 'purge_host',
              })
              .option('targets', {
                alias: 'T',
                type: 'array',
                description: '刷新目标',
                demandOption: true,
              })
          }, async (argv) => {
            await runTEOTask({
              ZoneId: argv.zoneId || createPurgeTaskRequest.ZoneId,
              Type: argv.type,
              Targets: argv.targets as string[],
            })
          })
        },
        async (_argv) => {
          const zoneIdList = await getTEOZoneList()
          const zoneId = await consola.prompt('ZoneId', {
            type: 'select',
            options: zoneIdList || [],
            initial: createPurgeTaskRequest.ZoneId,
          }) as any as string

          const dnsList = await getTEOZoneDnsList(zoneId)

          const type = await consola.prompt('Type', {
            type: 'select',
            options: [
              { label: 'purge_host', value: 'purge_host', hint: 'Hostname 刷新' },
              { label: 'purge_url', value: 'purge_url', hint: 'URL 刷新' },
              { label: 'purge_prefix', value: 'purge_prefix', hint: '目录刷新' },
              { label: 'purge_all', value: 'purge_all', hint: '站点在节点的全部缓存资源' },
              { label: 'purge_cache_tag', value: 'purge_cache_tag', hint: 'Cache-Tag 刷新' },
            ],
            initial: createPurgeTaskRequest.Type,
          })
          const targets = await consola.prompt('Targets', {
            type: 'multiselect',
            options: dnsList || [],
          }) as any as string[]

          console.log('type:', type)
          await runTEOTask({
            ZoneId: zoneId,
            Type: type as any as string,
            Targets: targets,
          })
        },
      )
        .command('scf', '云函数', () => {
          return args.command('clear', '清理 SCF 版本', () => {
            return args
              .option('interactive', {
                alias: 'i',
                type: 'boolean',
                description: '交互模式',
              })
              .option('Namespace', {
                alias: 'n',
                type: 'string',
                description: '命名空间',
              })
              .option('FunctionName', {
                alias: 'f',
                type: 'string',
                description: '函数名称',
              })
          }, async (argv) => {
            clearSCFVersionsByArgv(argv)
          })
        })
    },
    async () => {

    },
  )
}
