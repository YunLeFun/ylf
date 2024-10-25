import type { ArgumentsCamelCase } from 'yargs'
import { clearSCFVersions } from '../../../../tencent-cloud'

export async function clearSCFVersionsByArgv(argv: ArgumentsCamelCase<{
  interactive: boolean | undefined
} & {
  Namespace: string | undefined
} & {
  FunctionName: string | undefined
}>) {
  // asd

  await clearSCFVersions({
    ...argv,
    interactive: argv.interactive,
    Namespace: argv.Namespace,
  })
}
