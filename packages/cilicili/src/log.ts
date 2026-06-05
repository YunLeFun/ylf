import { colors } from 'consola/utils'

// 符号
export const RAW_SYMBOLS = {
  block: '┃',
  start: '◐',
  pointer: '❯',
  uncheck: '◌',

  success: '✔',
  info: 'ℹ',
  warn: '⚠',
  error: '✖',

  line: '│',
  end: '└',
}

/**
 * 彩色符号
 * @example colors.green(symbols.success)
 */
export const COLORFUL_SYMBOLS = {
  block: colors.bold(colors.dim(RAW_SYMBOLS.block)),
  start: colors.magenta(RAW_SYMBOLS.start),
  uncheck: colors.gray(RAW_SYMBOLS.uncheck),
  pointer: colors.cyan(RAW_SYMBOLS.pointer),

  success: colors.green(RAW_SYMBOLS.success),
  info: colors.blue(RAW_SYMBOLS.info),
  warn: colors.yellow(RAW_SYMBOLS.warn),
  error: colors.red(RAW_SYMBOLS.error),

  line: colors.dim(RAW_SYMBOLS.line),
}

/**
 * 行首彩色符号，用于 `console.log(xxxStart, ...args)`
 * @example console.log(errorStart, '执行失败') // ✖ 执行失败
 */
export const lineStart = COLORFUL_SYMBOLS.line
export const successStart = COLORFUL_SYMBOLS.success
export const infoStart = COLORFUL_SYMBOLS.info
export const warnStart = COLORFUL_SYMBOLS.warn
export const errorStart = COLORFUL_SYMBOLS.error

/**
 * console.log(lineStart, ...args)
 * @example
 * │ ...args
 */
export function consoleInnerInfo(...args: any[]) {
  console.info(COLORFUL_SYMBOLS.line, ...args)
}

export function consoleInfo(data: Record<string, any>) {
  for (const key in data) {
    consoleInnerInfo(colors.dim(key), data[key] || '')
  }
}
