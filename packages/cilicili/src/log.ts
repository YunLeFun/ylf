import { colors } from 'consola/utils'

// 符号
export const symbols = {
  success: '✔',
  error: '✖',
  line: '│',
  end: '└',
}

export const lineStart = colors.dim('│')
export const errorStart = colors.red('✖')
export const successStart = colors.green('✔')

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
