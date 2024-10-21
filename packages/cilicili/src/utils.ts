/**
 * @zh 等待指定时间 (毫秒)
 * @en Wait for a specified time (milliseconds)
 * @example await sleep(1000)
 */
export async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
