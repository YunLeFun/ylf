import process from 'node:process'
import { parseCli } from './cli'
import 'dotenv/config'

export * from './auth'
export * from './pages'

export async function main() {
  try {
    await parseCli()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`✖ ${message}`)
    process.exitCode = 1
  }
}
