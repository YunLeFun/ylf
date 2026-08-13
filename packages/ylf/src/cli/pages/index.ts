import type { Argv } from 'yargs'
import path from 'node:path'
import process from 'node:process'
import { initializePagesConfig, resolvePagesConfig } from '../../pages/config'
import { deployPagesScan } from '../../pages/deploy'
import { scanPagesDirectory } from '../../pages/scanner'

export function registerPagesCommand(args: Argv): void {
  args.command('pages', '部署一方静态目录到 Pages 项目子目录', pagesArgs => pagesArgs
    .command('init', '创建 ylf.pages.json', initArgs => initArgs
      .option('workspace', {
        type: 'string',
        default: 'yunlefun',
        description: 'Pages 工作区',
      })
      .option('project', {
        type: 'string',
        description: '不可变项目路径；默认使用当前目录名',
      })
      .option('output', {
        type: 'string',
        default: 'dist',
        description: '构建产物目录（相对配置文件）',
      })
      .option('force', {
        type: 'boolean',
        default: false,
        description: '覆盖现有配置',
      }), async (argv) => {
      const result = await initializePagesConfig({
        workspace: argv.workspace,
        project: argv.project ?? path.basename(process.cwd()),
        output: argv.output,
        force: argv.force,
      })
      console.log(`✓ 已创建 ${result.configPath}`)
      console.log(`构建时请设置 base path：/${result.config.project}/`)
    })
    .command('deploy [directory]', '扫描并部署静态目录', deployArgs => deployArgs
      .positional('directory', {
        type: 'string',
        description: '构建产物目录；可覆盖配置文件 output',
      })
      .option('config', {
        type: 'string',
        description: '显式指定 ylf.pages.json',
      })
      .option('workspace', {
        type: 'string',
        description: '覆盖工作区',
      })
      .option('project', {
        type: 'string',
        description: '覆盖项目路径',
      })
      .option('clean', {
        type: 'boolean',
        default: true,
        description: '清理上一份受管清单中的旧文件；可用 --no-clean 关闭',
      })
      .option('allow-large-delete', {
        type: 'boolean',
        default: false,
        description: '明确允许服务端计划的大规模删除',
      })
      .option('allow-no-index', {
        type: 'boolean',
        default: false,
        description: '允许没有 index.html 的纯资源目录',
      })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        description: '仅在本地扫描，不登录、不访问 Admin 或 COS',
      })
      .option('api', {
        type: 'string',
        description: '覆盖 Admin API 地址',
      })
      .option('concurrency', {
        type: 'number',
        default: 8,
        description: '哈希和上传并发数（1–16）',
      })
      .option('json', {
        type: 'boolean',
        default: false,
        description: '输出 JSON 结果',
      }), async (argv) => {
      const config = await resolvePagesConfig({
        configPath: argv.config,
        overrides: {
          workspace: argv.workspace,
          project: argv.project,
          output: argv.directory,
        },
      })
      console.log(`目标工作区：${config.workspace}/${config.project}`)
      console.log(`请确认构建工具 base path 为 /${config.project}/；ylf 不会自动改写产物。`)
      console.warn('⚠ 直接目录同步不是原子切换；固定文件名可能短暂出现混合版本。')
      const scan = await scanPagesDirectory({
        directory: config.outputDirectory,
        allowNoIndex: argv.allowNoIndex,
        concurrency: argv.concurrency,
      })
      if (argv.dryRun) {
        const result = {
          dryRun: true,
          workspace: config.workspace,
          project: config.project,
          directory: scan.root,
          fileCount: scan.fileCount,
          totalBytes: scan.totalBytes,
          clean: argv.clean,
        }
        console.log(JSON.stringify(result, null, argv.json ? 0 : 2))
        return
      }
      const result = await deployPagesScan({
        workspace: config.workspace,
        project: config.project,
        scan,
        clean: argv.clean,
        allowLargeDelete: argv.allowLargeDelete,
        allowNoIndex: argv.allowNoIndex,
        apiBaseUrl: argv.api,
        concurrency: argv.concurrency,
        onProgress: argv.json ? undefined : message => console.log(message),
      })
      console.log(argv.json ? JSON.stringify(result) : `✓ 部署成功：${result.url}`)
    })
    .demandCommand(1, '请选择 pages 子命令：init 或 deploy'))
}
