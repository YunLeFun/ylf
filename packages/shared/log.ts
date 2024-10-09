import { colors } from 'consola/utils'

export const lineStart = colors.dim('│')

export function consoleInfo(data: Record<string, any>) {
  for (const key in data) {
    console.info(lineStart, colors.dim(key), data[key] || '')
  }
}
