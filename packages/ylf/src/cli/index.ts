import process from 'node:process'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { version } from '../../package.json'
import { registerTencentCloudCommand } from './tencent'

const cli = yargs(hideBin(process.argv))
  .scriptName('ylf')
  .version(version)
  .showHelpOnFail(false)
  .exitProcess(false)
  .fail((message, error) => {
    throw error || new Error(message || '命令执行失败')
  })
  .alias('h', 'help')
  .alias('v', 'version')

cli.command('hello', 'Prints "Hello, World!"', () => {
  console.log('Hello, World!')
})

registerTencentCloudCommand(cli)

export async function parseCli() {
  await cli
    .help()
    .parseAsync()
}
