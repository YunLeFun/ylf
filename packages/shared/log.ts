import { colors } from 'consola/utils'

export const lineStart = colors.dim('│')
export const errorStart = colors.red('✖')

/**
 * console.log(lineStart, ...args)
 * @example
 * │ ...args
 */
export function consoleInnerInfo(...args: any[]) {
  console.info(lineStart, ...args)
}

export function consoleInfo(data: Record<string, any>) {
  for (const key in data) {
    consoleInnerInfo(colors.dim(key), data[key] || '')
  }
}
