import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface'
import type { TagInfo } from 'tencentcloud-sdk-nodejs/tencentcloud/services/tcr/v20190924/tcr_models'

import type { DeployConfig, TencentDeployConfig } from '../types'
import path from 'node:path'

import process from 'node:process'
import { consoleInnerInfo, sleep } from 'cilicili'

import consola from 'consola'
import { colors } from 'consola/utils'
import { formatDate } from 'date-fns'
import { execa } from 'execa'
import fs from 'fs-extra'
import gradient from 'gradient-string'
import tencentcloud from 'tencentcloud-sdk-nodejs'

const defaultClientConfig: ClientConfig = {
  region: 'ap-shanghai',
  credential: {
    secretId: process.env.TENCENT_CLOUD_SECRET_ID,
    secretKey: process.env.TENCENT_CLOUD_SECRET_KEY,
  },
}

/**
 * 本地构建并推送 Docker 镜像
 */
export async function buildAndPushDockerImage(options: {
  repoName: string
  dockerTag: string
  registry?: string
}) {
  const { repoName, dockerTag, registry } = options
  try {
    await execa('docker', ['build', '-t', `${repoName}:${dockerTag}`, '.'])
  }
  catch (error) {
    consola.error('构建 Docker 镜像失败')
    throw error
  }
  // 向 Registry 中推送镜像
  consola.start('🚀 推送 Docker 镜像至 TCR')
  await execa('docker', ['tag', repoName, `${registry}/${repoName}:${dockerTag}`])
  await execa('docker', ['push', `${registry}/${repoName}:${dockerTag}`])
}

/**
 * 等待云函数变为可用状态
 */
export async function waitSCFReady(options: {
  config: TencentDeployConfig
  scfClient: InstanceType<typeof tencentcloud.scf.v20180416.Client>
}) {
  let isFunctionReady = false
  const maxRetry = 12
  const retryInterval = 5000
  let retryCount = 0

  const { scfClient, config } = options
  while (!isFunctionReady) {
    const funRes = await scfClient.GetFunction({
      ...config.tencent.scf.function,
    })
    if (funRes.Status === 'Active') {
      isFunctionReady = true
    }
    else {
      consoleInnerInfo(`   ${colors.dim('等待云函数变为可用状态...')}`)
      await sleep(retryInterval)
      retryCount++
      if (retryCount > maxRetry) {
        throw new Error('云函数部署超时，请稍后再试。')
      }
    }
  }

  return isFunctionReady
}

const cyanBlue = gradient(['cyan', 'blue'])

/**
 * 部署 SCF
 */
export async function deployTencentSCF(config: TencentDeployConfig) {
  // get commitId
  const commitId = await execa('git', ['rev-parse', 'HEAD'])
  const version = formatDate(new Date(), 'yyyyMMdd-HHmm')

  console.log(cyanBlue('🚀 部署腾讯云 SCF...'))
  console.log()

  const SCFClient = tencentcloud.scf.v20180416.Client
  const scfClient = new SCFClient(Object.assign(defaultClientConfig, config.tencent.client))

  // 防呆校验
  const dockerfilePath = path.resolve(process.cwd(), 'Dockerfile')
  const isDockerfileExists = await fs.exists(dockerfilePath)

  if (!isDockerfileExists) {
    consola.error('请确保项目根目录存在 Dockerfile 文件')
    throw new Error('请确保项目根目录存在 Dockerfile 文件')
  }

  // 构建 docker 镜像，上传到 TCR
  const repoName = config.tencent.tcr.image.RepoName
  let dockerTag = 'latest'
  const tcrDomain = 'ccr.ccs.tencentyun.com'
  // build docker
  if (config.docker?.local) {
    consola.start('🐳 本地构建 Docker 镜像')
    await buildAndPushDockerImage({
      repoName,
      dockerTag,
      registry: tcrDomain,
    })
  }
  else {
    consola.start('🐳 远程构建 Docker 镜像')
  }

  // 查询 Docker 镜像
  const TCRClient = tencentcloud.tcr.v20190924.Client
  const tcrClient = new TCRClient(Object.assign(defaultClientConfig, config.tencent.client))

  // loop
  // docker 最大超时 500s
  const maxTimeout = config.docker?.timeout || 500 * 1000
  const checkInterval = config.docker?.interval || 5 * 1000

  const startCheckTime = Date.now()
  const isTimeout = () => (Date.now() - startCheckTime) > maxTimeout
  let latestTagInfo: TagInfo | undefined
  while (!isTimeout()) {
    consoleInnerInfo(`   ${colors.dim('检查 Docker 镜像构建状态...')}`)
    const describeImageRes = await tcrClient.DescribeImagePersonal({
      Limit: 1,
      ...config.tencent.tcr.image,
    })

    if (describeImageRes.Data?.TagInfo.length === 0) {
      consoleInnerInfo('  🐳 等待镜像构建中...')
      await sleep(checkInterval)
      continue
    }
    else {
      latestTagInfo = describeImageRes.Data?.TagInfo[0]
      dockerTag = latestTagInfo?.TagName || ''
      consola.success(
        '🐳 最新镜像',
        colors.magenta(latestTagInfo?.TagName || ''),
        colors.gray(latestTagInfo?.DockerVersion || latestTagInfo?.Author || latestTagInfo?.Architecture || ''),
        colors.yellow(latestTagInfo?.Size || latestTagInfo?.SizeByte ? `${(latestTagInfo.SizeByte / 1024 / 1024).toFixed(2)}MB` : ''),
        colors.dim(latestTagInfo?.UpdateTime || ''),
      )
      // console.dir(latestTagInfo)
      break
    }
  }

  if (isTimeout()) {
    consola.error('构建 Docker 镜像超时', 'https://console.cloud.tencent.com/tcr/repository')
    throw new Error('构建 Docker 镜像超时')
  }

  // 准备发布云函数
  const functionName = config.tencent.scf.function.FunctionName
  if (!functionName) {
    throw new Error('请配置云函数名称 tenant.scf.function.FunctionName')
  }
  try {
    const _funRes = await scfClient.GetFunction({
      ...config.tencent.scf.function,
    })
    // if (funRes.Status !== 'Active') {
    //   throw new Error(`云函数 ${functionName} (${colors.red(funRes.Status || '')}) 不处于可用状态，可能有其他开发者正在更新此云函数。请稍后再试。`)
    // }
  }
  catch (error: any) {
    if (error.code === 'ResourceNotFound.Function') {
      console.error(`云函数 ${functionName} 不存在，请手动创建。`)
    }
    throw error
  }

  console.log()
  consola.start('🚀 更新云函数代码', `${colors.dim(tcrDomain)}/${repoName}:${colors.magenta(dockerTag)}`)
  await scfClient.UpdateFunctionCode({
    FunctionName: functionName,
    Namespace: config.tencent.scf.function.Namespace,
    Code: {
      ImageConfig: {
        ImageType: config.tencent.tcr.type || 'personal',
        ImageUri: `${tcrDomain}/${repoName}:${dockerTag}`,
        ContainerImageAccelerate: true,
        Args: config.tencent.scf.args,
      },
    },
  })
  // 等待云函数变为可用状态
  await waitSCFReady({
    config,
    scfClient,
  })
  consola.success('🎉 云函数已可用')

  // 发布新版本
  console.log()
  consola.start('🚀 发布新版本')
  const versionRes = await scfClient.PublishVersion({
    FunctionName: functionName,
    Description: `v${version} (image: ${repoName}:${dockerTag})`,
    Namespace: config.tencent.scf.function.Namespace,
  })

  // 等待云函数变为可用状态
  await waitSCFReady({
    config,
    scfClient,
  })

  const functionVersion = versionRes.FunctionVersion || '1'
  const scfVersion = Number(functionVersion)
  consoleInnerInfo(`   切换别名 ${colors.dim(config.tencent.scf.alias.name)} 流量`)
  await scfClient.UpdateAlias({
    Name: functionName,
    FunctionName: functionName,
    FunctionVersion: functionVersion,
  })
  consola.success('🚀 部署完成', `版本 ${functionVersion}`)

  // 清理旧版本
  // 注意：这里删除的是上上个版本。因为发布新版本后，可能访问旧版本的流量还会存在一段时间
  // 如果直接删除上一个版本，可能会导致短时间内云函数无法正常访问，因此，只清理上上个版本
  console.log()
  consola.start('🧹 清理旧版本')
  if (scfVersion > 2) {
    try {
      await scfClient.DeleteFunction({
        FunctionName: functionName,
        Qualifier: String(scfVersion - 2),
        Namespace: config.tencent.scf.function.Namespace,
      })
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    }
    catch (error: any) {
      if (error.code !== 'ResourceNotFound.Qualifier') {
        throw error
      }
    }
  }
  else {
    consola.info(`旧版本 ${scfVersion - 2} 不存在，无需清理。`)
  }
}
