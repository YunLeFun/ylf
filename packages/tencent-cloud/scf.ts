import consola from 'consola'
import { colors } from 'consola/utils'
import tencentcloud from 'tencentcloud-sdk-nodejs'
import { defaultTencentClientConfig } from './config'

/**
 * 清理 SCF 版本
 */
export async function clearSCFVersions(options: {
  interactive?: boolean

  scfClient?: InstanceType<typeof tencentcloud.scf.v20180416.Client>
  scfVersion?: number
  Namespace?: string
  FunctionName?: string
}) {
  let { interactive = false, scfVersion = 0, scfClient, Namespace, FunctionName } = options
  if (!scfClient) {
    consola.info('未传入自定义 SCF Client，初始化 SCF 客户端')
    scfClient = new tencentcloud.scf.v20180416.Client(Object.assign({}, defaultTencentClientConfig))
  }

  async function deleteSCFVersion(options: {
    Namespace?: string
    FunctionName: string
    Qualifier: string
  }) {
    if (!FunctionName) {
      throw new Error('请传入 FunctionName')
    }

    const qualifierStr = colors.cyan(options.Qualifier)
    try {
      await scfClient?.DeleteFunction({
        Namespace: options.Namespace,
        FunctionName: options.FunctionName,
        Qualifier: options.Qualifier,
      })
      consola.success(`🎉 删除旧版本 ${qualifierStr} 成功`)
    }
    catch (error: any) {
      consola.error(`删除旧版本 ${qualifierStr} 失败: ${colors.bgRed(` ${error.code} `)} ${colors.red(error.message)}`)
    }
  }

  // 交互模式
  if (interactive) {
    const namespaces = await scfClient.ListNamespaces({})
    Namespace = await consola.prompt('Namespace', {
      type: 'select',
      options: namespaces.Namespaces?.map(ns => ns.Name).filter((n): n is string => Boolean(n)) || [],
    }) as string

    const functions = await scfClient.ListFunctions({
      Namespace,
    })
    FunctionName = await consola.prompt('FunctionName', {
      type: 'select',
      options: functions.Functions?.map(fn => fn.FunctionName).filter((n): n is string => Boolean(n)) || [],
    }) as string

    const versions = await scfClient.ListVersionByFunction({
      Namespace,
      FunctionName,
      Order: 'DESC',
    })
    const chosenSCFVersions = await consola.prompt('Version', {
      type: 'multiselect',
      options: versions.Versions?.map((v) => {
        return {
          label: `${colors.cyan(v.Version || '')} ${v.Description}`,
          value: v.Version || '',
          hint: v.Version === '$LATEST' ? colors.dim('默认版本不能被删除') : '',
        }
      }) || [],
    }) as any as string
    // value
    if (chosenSCFVersions && chosenSCFVersions.length > 0) {
      for (const version of chosenSCFVersions) {
        if (version && version !== '$LATEST') {
          await deleteSCFVersion({
            Namespace,
            FunctionName,
            Qualifier: version,
          })
        }
      }
    }
    else {
      consola.info('未选择任何版本，取消清理')
    }
  }
  else {
    if (!FunctionName) {
      throw new Error('请传入 FunctionName')
    }

    // 清理旧版本
    // 注意：这里删除的是上上个版本。因为发布新版本后，可能访问旧版本的流量还会存在一段时间
    // 如果直接删除上一个版本，可能会导致短时间内云函数无法正常访问，因此，只清理上上个版本
    console.log()
    consola.start(`🧹 清理旧版本 ${colors.cyan(scfVersion)}`)
    if (scfVersion < 1) {
      consola.info(`旧版本 ${scfVersion || ''} 不存在，无需清理。`)
    }
    else {
      await deleteSCFVersion({
        Namespace,
        FunctionName,
        Qualifier: scfVersion.toString(),
      })
    }
  }
}
