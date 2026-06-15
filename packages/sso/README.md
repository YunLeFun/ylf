# @yunlefun/sso

云乐坊（Yunle.fun）跨站 SSO：**一处登录、各站免登**。

主站 `www.yunle.fun` 登录一次，其他共享同一套 CloudBase Auth 的子应用（`*.yunle.fun` 等）即可静默复用登录态，`uid` 全平台一致。

- **Consumer（子应用）** 用主入口 `@yunlefun/sso`：一行 `signInWithSso` 在 web 与云乐坊原生 App 容器内都免登（自动选路）。
- **Provider（主站桥接页）** 用 `@yunlefun/sso/protocol`：解析请求、校验请求方。
- 两端共用同一份**协议常量与消息契约**，杜绝跨仓漂移。

> 机制原理、安全模型与排错见 [跨站 SSO 接入指南](https://docs.yunle.fun/account/sso)。

> ⚠️ **受信任站点专用，非开放第三方登录。** 桥接会把含 `refresh_token` 的完整登录态交给接入站点，
> 且站点 origin 必须由云乐坊管理员加入白名单。只用于你自己掌控/完全信任的站点；面向任意第三方的开放式
> 「用云乐坊登录」需 OAuth 授权码流程，不在本包范围。

## 安装

```bash
pnpm add @yunlefun/sso
```

## 子应用（Consumer）

```ts
import cloudbase from '@cloudbase/js-sdk'
import { signInWithSso } from '@yunlefun/sso'

const app = cloudbase.init({ env: 'yunlefun-8g7ybcxc7345c490' })
const auth = app.auth({ persistence: 'local' })

// 进站静默同步：主站已登录则子应用自动登录
const res = await signInWithSso(auth, { mode: 'silent' })
if (!res.ok) {
  // 未登录。把「用云乐坊账号登录」按钮接到弹窗模式：
  // await signInWithSso(auth, { mode: 'interactive' })
}
```

更细的控制：`requestSso()` 只取回 session，`adoptSession(auth, session)` 只注入。

## 原生 App 容器内（自动）

`signInWithSso()` 会**自动选路，调用方代码不变**：

- 普通 web → www.yunle.fun 的 postMessage 桥（上方）。
- 云乐坊原生容器内（apps.yunle.fun，注入 `window.ylf`）→ 走原生桥取**页面自己的**会话，宿主的 `refresh_token` 不下发给页面。

两条路终点都是 `auth.setSession()`，所以同一行 `signInWithSso(auth)` 在 web 和 App 容器里都免登。原生容器需注入 `window.ylf`（二选一，`getCloudbaseSession` 更优、免 CORS）：

```ts
window.ylf = {
  inYunleApp: true,
  // 推荐：原生内部完成「授权码→兑换」，直接返回会话
  getCloudbaseSession: opts => Promise<{ access_token, refresh_token } | null>,
  // 兜底：返回一次性授权码，页面向 exchangeUrl 兑换
  getAuthCode: opts => Promise<{ code }>,
}
```

## 主站桥接页（Provider）

`www.yunle.fun/auth/sso` 读本站 session，校验请求方后用 `postMessage` 回传：

```ts
import {
  isAnonymousSession,
  readSsoMode,
  readSsoNonce,
  readSsoTargetOrigin,
  SSO_RESULT_TYPE,
} from '@yunlefun/sso/protocol'
```

## API

| 入口                     | 导出                                                                                  | 用途                                |
| ------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------- |
| `@yunlefun/sso`          | `signInWithSso` / `requestSso` / `adoptSession`                                       | 子应用：发起 + 注入登录态           |
| `@yunlefun/sso`          | `isInYunleApp` / `requestSsoNative`                                                   | 原生容器内自适配（`window.ylf` 桥） |
| `@yunlefun/sso/protocol` | `SSO_RESULT_TYPE` / `SSO_QUERY_KEYS` / `parseSsoResultMessage` / `buildSsoRequestUrl` | 协议常量与消息校验                  |
| `@yunlefun/sso/protocol` | `readSsoMode` / `readSsoTargetOrigin` / `readSsoNonce` / `isAnonymousSession`         | 主站解析子站请求                    |

## 安全

跨站搬运的 session 含 `refresh_token`（长效凭证），桥接靠三道闸守住：**主站 origin 白名单** + **一次一令 nonce** + **来源窗口/精确 origin 校验**。白名单**只放第一方域名**——给第三方放行等于把账号钥匙送人。

## License

MIT
