// tencent cloud

import type { Argv } from 'yargs'

import { colors } from 'consola/utils'
import { clearSCFVersionsByArgv } from './scf'
import { runTEOTask } from './teo'
import {
  buildEdgeOnePurgeRequest,
  EDGEONE_PURGE_METHODS,
  EDGEONE_PURGE_TYPES,
} from './teo-purge'

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
        (teoArgs) => {
          return teoArgs.command('purge', '提交缓存刷新任务', (purgeArgs) => {
            return purgeArgs
              .option('zoneId', {
                alias: 'z',
                type: 'string',
                description: '站点 id',
                demandOption: true,
              })
              .option('type', {
                alias: 't',
                type: 'string',
                description: '刷新类型',
                choices: EDGEONE_PURGE_TYPES,
                default: 'purge_host',
              })
              .option('targets', {
                alias: 'T',
                type: 'array',
                description: '刷新目标；purge_all 时省略',
              })
              .option('method', {
                alias: 'm',
                type: 'string',
                choices: EDGEONE_PURGE_METHODS,
                description: '目录、Hostname 或全站刷新方法',
              })
              .option('cacheTagDomains', {
                type: 'array',
                description: 'Cache-Tag 生效域名',
              })
              .option('confirmAll', {
                type: 'string',
                description: 'purge_all 必须再次填写完整 ZoneId',
              })
              .option('dryRun', {
                type: 'boolean',
                default: false,
                description: '仅校验并输出请求，不访问腾讯云',
              })
              .option('json', {
                type: 'boolean',
                default: false,
                description: '以单行 JSON 输出任务结果',
              })
          }, async (argv) => {
            const request = buildEdgeOnePurgeRequest({
              zoneId: argv.zoneId,
              type: argv.type,
              targets: argv.targets,
              method: argv.method,
              cacheTagDomains: argv.cacheTagDomains,
              confirmAll: argv.confirmAll,
            })
            if (argv.dryRun) {
              console.log(JSON.stringify({ dryRun: true, request }, null, argv.json ? 0 : 2))
              return
            }
            await runTEOTask(request, { json: argv.json })
          })
            .demandCommand(1, '请选择 EdgeOne 子命令，例如 purge')
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
