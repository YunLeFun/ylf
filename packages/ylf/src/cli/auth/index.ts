import type { Argv } from 'yargs'
import { spawn } from 'node:child_process'
import process from 'node:process'
import {
  createAuthTokenStore,
  DEFAULT_YLF_API_BASE_URL,
  loginWithDeviceAuthorization,
  logoutAuthSession,
  refreshAuthSession,
} from '../../auth'

export function registerAuthCommand(args: Argv): void {
  args.command('auth', '登录和管理 ylf CLI 会话', authArgs => authArgs
    .command('login', '使用浏览器设备授权登录', loginArgs => loginArgs
      .option('api', {
        type: 'string',
        default: process.env.YLF_API_BASE_URL || DEFAULT_YLF_API_BASE_URL,
        description: 'YunLeFun Admin API 地址',
      })
      .option('browser', {
        type: 'boolean',
        default: true,
        description: '自动打开授权页面；可用 --no-browser 关闭',
      }), async (argv) => {
      if (process.env.CI || !process.stdout.isTTY)
        throw new Error('CI 或非交互终端不会启动设备登录；GitHub Actions 请使用 OIDC')
      const store = await createAuthTokenStore()
      if (store.kind === 'file')
        console.warn(`⚠ 系统 keychain 不可用，将使用 0600 文件：${store.location}`)
      await loginWithDeviceAuthorization({
        store,
        apiBaseUrl: argv.api,
        onPrompt(prompt) {
          console.log(`请在浏览器中打开：${prompt.verificationUri}`)
          console.log(`输入设备码：${prompt.userCode}`)
          if (argv.browser)
            openBrowser(prompt.verificationUriComplete)
        },
      })
      console.log(`✓ 登录成功，凭据已保存到 ${store.location}`)
    })
    .command('status', '查看本地登录状态', statusArgs => statusArgs.option('json', {
      type: 'boolean',
      default: false,
      description: '输出 JSON',
    }), async (argv) => {
      const store = await createAuthTokenStore()
      const session = await store.load()
      const status = session
        ? {
            loggedIn: session.refreshExpiresAt > Date.now(),
            accessExpiresAt: new Date(session.accessExpiresAt).toISOString(),
            refreshExpiresAt: new Date(session.refreshExpiresAt).toISOString(),
            apiBaseUrl: session.apiBaseUrl,
            storage: store.kind,
          }
        : { loggedIn: false, storage: store.kind }
      if (argv.json)
        console.log(JSON.stringify(status))
      else if (status.loggedIn)
        console.log(`已登录 ${'apiBaseUrl' in status ? status.apiBaseUrl : ''}（${store.kind}）`)
      else
        console.log('尚未登录；运行 ylf auth login')
    })
    .command('refresh', '立即轮换并刷新本地会话', {}, async () => {
      const store = await createAuthTokenStore()
      await refreshAuthSession({ store })
      console.log('✓ 登录会话已刷新')
    })
    .command('logout', '撤销并清除本地登录会话', {}, async () => {
      const store = await createAuthTokenStore()
      await logoutAuthSession({ store })
      console.log('✓ 已退出登录')
    })
    .demandCommand(1, '请选择 auth 子命令：login、status、refresh 或 logout'))
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? { executable: 'open', args: [url] }
    : process.platform === 'win32'
      ? { executable: 'cmd', args: ['/c', 'start', '', url] }
      : { executable: 'xdg-open', args: [url] }
  try {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
  }
  catch {
    // The URL and code are already printed; browser launch is best effort.
  }
}
