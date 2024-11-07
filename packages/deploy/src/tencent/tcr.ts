export const tcrDomain = 'ccr.ccs.tencentyun.com'

/**
 * 获取 TCR 控制台地址
 */
export function getConsoleTCRUrl(repoName: string) {
  return `https://console.cloud.tencent.com/tcr/repository/ccr/ccr/${repoName}/1/tagList`
}
