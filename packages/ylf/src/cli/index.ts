import process from 'node:process'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { version } from '../../package.json'
import { registerTencentCloudCommand } from './tencent'

const cli = yargs(hideBin(process.argv))
  .scriptName('ylf')
  .version(version)
  .showHelpOnFail(true)
  .alias('h', 'help')
  .alias('v', 'version')

cli.command('hello', 'Prints "Hello, World!"', () => {
  console.log('Hello, World!')
})
cli.option('debug', 'Enable debug mode', (argv) => {
  if (argv.debug) {
    process.env.NODE_DEBUG = 'http'
  }
})

registerTencentCloudCommand(cli)

export function parseCli() {
  cli
    .help()
    .parse()
}
