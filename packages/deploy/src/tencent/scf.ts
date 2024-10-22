import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface'
import type { DeployConfig, TencentDeployConfig } from '../types'

import path from 'node:path'
import process from 'node:process'

import { consoleInnerInfo } from 'cilicili'
import consola from 'consola'

import { formatDate } from 'date-fns'

import { execa } from 'execa'
import fs from 'fs-extra'
import tencentcloud from 'tencentcloud-sdk-nodejs'

const defaultClientConfig: ClientConfig = {
  region: 'ap-shanghai',
  credential: {
    secretId: process.env.TENCENT_CLOUD_SECRET_ID,
    secretKey: process.env.TENCENT_CLOUD_SECRET_KEY,
  },
}

/**
 * 部署 SCF
 */
export async function deployTencentSCF(config: TencentDeployConfig) {
  // get commitId
  const commitId = await execa('git', ['rev-parse', 'HEAD'])
  const version = formatDate(new Date(), 'yyyyMMdd-HHmm')

  consola.start('部署腾讯云 SCF...')
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
  consoleInnerInfo('🐳 构建 Docker 镜像')
  const tcrDomain = 'ccr.ccs.tencentyun.com'
  const repoName = config.tencent.tcr.image.RepoName
  const dockerTag = 'latest'

  // build docker
  try {
    await execa('docker', ['build', '-t', `${repoName}:${dockerTag}`, '.'])
  }
  catch (error) {
    consola.error('构建 Docker 镜像失败')
    throw error
  }
  // 向 Registry 中推送镜像
  consola.start('🚀 推送 Docker 镜像至 TCR')
  await execa('docker', ['tag', repoName, `${tcrDomain}/${repoName}:${dockerTag}`])
  await execa('docker', ['push', `${tcrDomain}/${repoName}:${dockerTag}`])

  // 查询 Docker 镜像
  const TCRClient = tencentcloud.tcr.v20190924.Client
  const tcrClient = new TCRClient(Object.assign(defaultClientConfig, config.tencent.client))

  const describeImageRes = await tcrClient.DescribeImagePersonal({
    Limit: 1,
    ...config.tencent.tcr.image,
  })
  if (describeImageRes.Data?.TagInfo.length === 0) {
    consola.error('请确保 TCR 仓库中存在镜像')
    throw new Error('请确保 TCR 仓库中存在镜像')
  }

  // 准备发布云函数
  const functionName = config.tencent.scf.function.FunctionName
  if (!functionName) {
    throw new Error('请配置云函数名称 tenant.scf.function.FunctionName')
  }
  try {
    const funRes = await scfClient.GetFunction({
      ...config.tencent.scf.function,
    })
    if (funRes.Status !== 'Active') {
      throw new Error(`云函数 ${functionName} 不处于可用状态，可能有其他开发者正在更新此云函数。请稍后再试。`)
    }
  }
  catch (error: any) {
    if (error.code === 'ResourceNotFound.Function') {
      console.error(`云函数 ${functionName} 不存在，请手动创建。`)
    }
    throw error
  }

  consola.start('🚀 更新云函数代码', `${tcrDomain}/${repoName}:${dockerTag}`)
  await scfClient.UpdateFunctionCode({
    FunctionName: functionName,
    Code: {
      ImageConfig: {
        ImageType: config.tencent.tcr.type || 'personal',
        ImageUri: `${tcrDomain}/${repoName}:${dockerTag}`,
        ContainerImageAccelerate: true,
        Args: config.tencent.scf.args,
      },
    },
  })

  // 发布新版本
  consola.start('🚀 发布新版本')
  await scfClient.PublishVersion({
    FunctionName: functionName,
    Description: `v${version} (image: ${repoName}:${commitId})`,
  })

  // 清理旧版本
  // 注意：这里删除的是上上个版本。因为发布新版本后，可能访问旧版本的流量还会存在一段时间
  // 如果直接删除上一个版本，可能会导致短时间内云函数无法正常访问，因此，只清理上上个版本
  consola.start('🧹 清理旧版本')
}
