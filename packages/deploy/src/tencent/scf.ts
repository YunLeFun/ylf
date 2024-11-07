import type { TagInfo } from 'tencentcloud-sdk-nodejs/tencentcloud/services/tcr/v20190924/tcr_models'

import type { TencentDeployConfig } from '../types'
import path from 'node:path'

import process from 'node:process'
import { consoleInnerInfo, lineStart, sleep } from 'cilicili'

import consola from 'consola'
import { colors } from 'consola/utils'
import { formatDate } from 'date-fns'
import { execa } from 'execa'
import fs from 'fs-extra'
import gradient from 'gradient-string'
import tencentcloud from 'tencentcloud-sdk-nodejs'

import { clearSCFVersions } from '../../../tencent-cloud'
import { defaultTencentClientConfig } from '../../../tencent-cloud/config'
import { TencentNotification } from './notification'
import { getConsoleTCRUrl, tcrDomain } from './tcr'

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
  Qualifier?: string
}) {
  let isFunctionReady = false
  const maxRetry = 12
  const retryInterval = 5000
  let retryCount = 0

  const { scfClient, config } = options
  while (!isFunctionReady) {
    const funRes = await scfClient.GetFunction({
      ...config.tencent.scf.function,
      Qualifier: options.Qualifier,
    })
    // funRes.CodeError
    consoleInnerInfo(
      '  ',
      colors.dim('云函数状态:'),
      colors.cyan(funRes.Status || ''),
      colors.dim(funRes.StatusDesc || funRes.StatusReasons?.join(', ') || ''),
    )
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

/**
 * 等待 Docker 镜像构建完成
 */
export async function waitDockerImageReady(options: {
  config: TencentDeployConfig
}) {
  const { config } = options

  // get commitId
  const commitId = (await execa('git', ['rev-parse', 'HEAD'])).stdout.slice(0, 8)

  // 查询 Docker 镜像
  const TCRClient = tencentcloud.tcr.v20190924.Client
  const tcrClient = new TCRClient(Object.assign(defaultTencentClientConfig, config.tencent.client))

  // loop
  // docker 最大超时 500s
  const maxTimeout = config.docker?.timeout || 500 * 1000
  const checkInterval = config.docker?.interval || 5 * 1000

  const startCheckTime = Date.now()
  const isTimeout = () => (Date.now() - startCheckTime) > maxTimeout

  let latestTagInfo: TagInfo | undefined
  let dockerTag = ''
  while (!isTimeout()) {
    consoleInnerInfo(`   ${colors.dim('检查镜像构建状态...')} ${getConsoleTCRUrl(config.tencent.tcr.image.RepoName)}`)
    const describeImageRes = await tcrClient.DescribeImagePersonal({
      Limit: 1,
      ...config.tencent.tcr.image,
    })
    if (describeImageRes.Data?.TagInfo.length === 0) {
      consoleInnerInfo('⌛️ 等待镜像构建中...')
      await sleep(checkInterval)
      continue
    }
    latestTagInfo = describeImageRes.Data?.TagInfo[0]

    if (latestTagInfo?.TagName.includes(commitId)) {
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
    else {
      consoleInnerInfo('⌛️ 等待新镜像构建中...')
      await sleep(checkInterval)
      continue
    }
  }

  if (isTimeout()) {
    consola.error('构建 Docker 镜像超时', 'https://console.cloud.tencent.com/tcr/repository')
    throw new Error('构建 Docker 镜像超时')
  }

  return {
    dockerTag,
    latestTagInfo,
  }
}

/**
 * 部署 SCF
 */
export async function deployTencentSCF(config: TencentDeployConfig) {
  const version = formatDate(new Date(), 'yyyyMMdd-HHmm')

  console.log(gradient(['cyan', 'blue'])('🚀 部署腾讯云 SCF...'))
  console.log(`🔗 ${colors.underline('https://console.cloud.tencent.com/scf/list')}`)
  console.log()

  let tNotification: TencentNotification | undefined
  if (config.notification?.feishu?.enable) {
    tNotification = new TencentNotification(config)
  }

  const SCFClient = tencentcloud.scf.v20180416.Client
  const scfClient = new SCFClient(Object.assign(defaultTencentClientConfig, config.tencent.client))

  await tNotification?.sendStartMsg()
  console.log()

  // 防呆校验
  const dockerfilePath = config.docker?.Dockerfile || path.resolve(process.cwd(), 'Dockerfile')
  const isDockerfileExists = await fs.exists(dockerfilePath)

  if (!isDockerfileExists) {
    consola.error('请确保项目根目录存在 Dockerfile 文件')
    throw new Error('请确保项目根目录存在 Dockerfile 文件')
  }

  // 构建 docker 镜像，上传到 TCR
  const repoName = config.tencent.tcr.image.RepoName
  // build docker
  if (config.docker?.local) {
    consola.start('🐳 本地构建 Docker 镜像')
    await buildAndPushDockerImage({
      repoName,
      dockerTag: 'latest',
      registry: tcrDomain,
    })
  }
  else {
    consola.start('🐳 远程构建 Docker 镜像')
  }

  // 等待 Docker 镜像构建完成
  const { dockerTag, latestTagInfo } = await waitDockerImageReady({
    config,
  })

  // 准备发布云函数
  const { FunctionName, Namespace } = config.tencent.scf.function
  if (!FunctionName) {
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
      console.error(`云函数 ${FunctionName} 不存在，请手动创建。`)
    }
    throw error
  }

  console.log()
  consola.start('🚀 更新云函数代码', `${colors.dim(tcrDomain)}/${repoName}:${colors.magenta(dockerTag)}`)
  await scfClient.UpdateFunctionCode({
    FunctionName,
    Namespace,
    Code: {
      ImageConfig: {
        ...config.tencent.scf.ImageConfig,
        ImageType: config.tencent.scf.ImageConfig.ImageType || 'personal',
        ImageUri: `${tcrDomain}/${repoName}:${dockerTag}`,
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
  const Description = `v${version} (image: ${repoName}:${dockerTag})`
  const versionRes = await scfClient.PublishVersion({
    Namespace,
    FunctionName,
    Description,
  })
  consola.debug(versionRes)
  consoleInnerInfo(
    '  ',
    colors.dim(`版本:`),
    versionRes.FunctionVersion,

    lineStart,

    colors.dim(`Runtime:`),
    versionRes.Runtime,
  )

  const functionVersion = versionRes.FunctionVersion || '1'
  const scfVersion = Number(functionVersion)
  const aliasName = config.tencent.scf.alias.name

  // 等待发布版本云函数变为可用状态
  await waitSCFReady({
    config,
    scfClient,
    Qualifier: functionVersion,
  })

  // https://cloud.tencent.com/document/product/583/46241
  if (aliasName) {
    if (aliasName === '$DEFAULT') {
      consoleInnerInfo(`   默认为 ${colors.cyan('$DEFAULT')} 别名，无需切换流量`)
    }
    else {
      consoleInnerInfo(`   切换别名 ${colors.cyan(aliasName)} 流量`)
      console.log({
        Name: aliasName,
        FunctionVersion: functionVersion,
        Namespace,
        FunctionName,
      })
      await scfClient.UpdateAlias({
        Name: aliasName,
        FunctionVersion: functionVersion,
        Namespace,
        FunctionName,
      })
    }
  }
  else {
    consoleInnerInfo(`   无别名，默认使用 ${colors.cyan('$DEFAULT')}`)
  }
  consola.success('🚀 部署完成', `版本 ${colors.cyan(functionVersion)}`)

  await tNotification?.sendDeployMsg({
    Description,
  })

  if (scfVersion > 2) {
    await clearSCFVersions({
      interactive: false,
      scfClient,
      scfVersion: scfVersion - 2,
      Namespace,
      FunctionName,
    })
  }
  else {
    consola.info(`旧版本 ${scfVersion || ''} 不存在，无需清理。`)
  }

  // notification
  if (config.notification?.feishu?.enable) {
    await tNotification?.sendFullMsg({
      functionVersion,
      latestTagInfo,
    })
  }
}
