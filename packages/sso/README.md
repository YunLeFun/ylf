# @yunlefun/sso

云乐坊（Yunle.fun）跨站 SSO：**一处登录、各站免登**，全平台 `uid` 一致。

主站 `www.yunle.fun` 登录一次，其他共享同一套 CloudBase Auth 的子应用（`*.yunle.fun`、EdgeOne 独立域等）即可免登。

> 机制原理与排错见 [跨站 SSO 接入指南](https://docs.yunle.fun/account/sso)。

> ⚠️ **受信任站点专用，非开放第三方登录。** 子站 origin 必须由云乐坊管理员加入白名单。只用于你自己掌控/完全信任的站点；面向任意第三方的「用云乐坊登录」需标准 OAuth 授权码流程，不在本包范围。

---

## 两种采用方式 —— 优先用「票据 → 独立会话」

子站拿到登录态有两条路，**新接入一律走前者**：

|            | **ticket → 独立会话（推荐）**                         | session 转发（旧／兜底）                                    |
| ---------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| 子站会话   | 自己**独立**的 CloudBase 会话（独立 `refresh_token`） | 复用主站会话（共享 `refresh_token`）                        |
| 续期       | **同源直连续期**，无需再跨站                          | 共享单次 `refresh_token`，轮换互相作废 → 过期只能反复跨站取 |
| 抗存储分区 | ✅（握手走顶层重定向，每跳第一方）                    | ❌（隐藏 iframe 在 Safari ITP 等下失效）                    |
| 安全       | 主站 `refresh_token` **不下发**                       | 主站 `refresh_token` 下发给子站                             |
| 采用       | `signInWithCustomTicket`                              | `setSession`（或自有 `setCredentials`）                     |

> 为什么共享 session 会坏：CloudBase 的 `refresh_token` 单次轮换，两个源共用一份会互相作废，子站会话死掉且无法续期——这是「显示登录但实际没登录」类问题的根因。ticket 让子站做**自己的一次登录**，从此各自续期、互不干扰。

握手优先级（最佳实践）：**顶层重定向 > 弹窗 > 隐藏 iframe**。重定向每一跳都在各自源的第一方上下文，是唯一能在第三方存储被分区的浏览器里完成首次握手的方式。

## 安装

```bash
pnpm add @yunlefun/sso
```

---

## 子应用（Consumer）

### 1. 登录 = 顶层重定向（推荐）

```ts
import { startSsoRedirect } from '@yunlefun/sso'

// 「用云乐坊账号登录」按钮：
function onLogin() {
  startSsoRedirect() // 整页跳到主站桥接页，登录后带一次性票据跳回；本函数不会 resolve
}
```

### 2. 应用启动时消费回跳 + 采用票据

```ts
import cloudbase from '@cloudbase/js-sdk'
import { adoptSsoTicket, consumeSsoRedirect } from '@yunlefun/sso'

const auth = cloudbase.init({ env: 'yunlefun-8g7ybcxc7345c490' }).auth({ persistence: 'local' })

// 启动时：若本次加载是一次 SSO 重定向回跳，兑换票据为「子站自己的独立会话」。
// consumeSsoRedirect 会校验 nonce、清理地址栏与暂存 nonce（票据不残留在历史）。
const redirect = consumeSsoRedirect()
if (redirect?.ok) {
  await adoptSsoTicket(auth, redirect.ticket) // → signInWithCustomTicket，建立独立会话
}
// 之后照常 auth.getSession() 读自己的会话；同源续期，不再跨站。
```

### 3. 一站式（自动选路，含原生容器 + 票据优先）

`signInWithSso` 仍可用：自动选路（web postMessage 桥 / 原生 `window.ylf` 桥），采用时**优先票据、回退 session**。适合不想手写两段式的场景；但 web 端首次握手仍是 iframe/popup（抗分区不如 redirect）。

```ts
import { signInWithSso } from '@yunlefun/sso'

const res = await signInWithSso(auth, { mode: 'silent' }) // 进站静默；未登录再 mode:'interactive'
```

> 更细的控制：`requestSso()` 只取回结果（含可选 `ticket`），`adoptSsoResult(auth, result)` 按「票据优先、session 回退」注入；自行用 `setCredentials` 适配的站点可只用 `requestSso` + 自己的采用逻辑。

### ⚠️ 坑：`signInWithCustomTicket` 的 v2 签名

CloudBase js-sdk **v2** 的 `auth.signInWithCustomTicket(getTickFn)` 接收一个**返回票据的函数**，不是票据字符串：

```ts
// ❌ 错（字符串被当函数调用 → 同步抛错、无网络请求、登录静默失败）
await auth.signInWithCustomTicket(ticket)
// ✅ 对
await auth.signInWithCustomTicket(() => Promise.resolve(ticket))
```

`adoptSsoTicket` / `adoptSsoResult`（≥0.3.1）已按此实现；自己直接调时务必传函数。

### 对账：陈旧登录态要清

`uid` 等登录展示态若缓存在 localStorage，会出现「显示已登录、但真实会话已失效」。最佳实践：**云调用确定性 `LOGIN_REQUIRED` 时清掉本地账号态**（登出），让 UI 反映真实；redirect 登录是一键的事，不必为防误登出而保留无效会话。

---

## 主站桥接页（Provider）

`www.yunle.fun/auth/sso` 读本站 session，校验请求方后按 `mode` 回传：

- `silent`（隐藏 iframe）/ `interactive`（弹窗）→ `postMessage` 回传 `{ session, ticket? }`。
- `redirect`（顶层）→ 校验 `returnUrl` 的 origin 在白名单内（**防开放重定向**），带 `#ylf_sso=<票据>` 跳回；**fragment 只放一次性票据，绝不放 `refresh_token`**（那是被废弃的 implicit flow 反模式）。未登录则先去 `/login` 再回桥接页。

```ts
import {
  encodeSsoRedirectResult,
  isAnonymousSession,
  readSsoMode,
  readSsoNonce,
  readSsoReturnUrl,
  readSsoTargetOrigin,
  SSO_REDIRECT_HASH_KEY,
  SSO_RESULT_TYPE,
} from '@yunlefun/sso/protocol'
```

### 票据从哪来：`createTicket`

桥接页凭**登录用户自己的登录态**调一个服务端云函数，函数用 CloudBase 自定义登录私钥 `createTicket(uid)` 签发票据，只签调用者自己的 uid。要点（都踩过）：

```js
// 云函数（@cloudbase/node-sdk）
const ctx = cloudbase.getCloudbaseContext()
const envId = ctx.TCB_ENV || ctx.SCF_NAMESPACE
const auth = cloudbase.init({
  env: envId,
  // ⚠️ credentials 必须带 env_id，且 = 运行时 env，否则报「私钥未包含 env_id」
  credentials: { env_id: envId, private_key_id, private_key },
}).auth()
// ⚠️ refresh / expire 单位是毫秒（不是秒）
const ticket = auth.createTicket(uid, { refresh: 3600_000, expire: Date.now() + 30 * 86400_000 })
```

### CloudBase 自定义登录配置（前提）

- 控制台 → 环境 → 登录授权 → **开启自定义登录**、生成签名私钥；或 API `manageAppAuth(createCustomLoginKeys)`（会自动开启 provider）。
- 把私钥注入签发函数的 env（PEM 建议 `\n` 转义或 base64）。
- ⚠️ **`createCustomLoginKeys` 是新增、不撤销旧密钥**；轮换/作废旧密钥只能在控制台做。私钥能为任意 uid 签发会话，按高敏密钥管理。

---

## API

| 入口                     | 导出                                                                                                                           | 用途                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `@yunlefun/sso`          | `startSsoRedirect` / `consumeSsoRedirect` / `adoptSsoTicket`                                                                   | **推荐**：重定向握手 + 票据采用                |
| `@yunlefun/sso`          | `signInWithSso` / `requestSso` / `adoptSsoResult` / `adoptSession`                                                             | 一站式 / 取回 / 注入（票据优先、session 回退） |
| `@yunlefun/sso`          | `isInYunleApp` / `requestSsoNative`                                                                                            | 原生容器内自适配（`window.ylf` 桥）            |
| `@yunlefun/sso/protocol` | `buildSsoRequestUrl` / `parseSsoResultMessage` / `parseSsoRedirectResult` / `SSO_RESULT_TYPE` / `SSO_REDIRECT_HASH_KEY`        | 子站：构造请求 + 校验回传                      |
| `@yunlefun/sso/protocol` | `readSsoMode` / `readSsoTargetOrigin` / `readSsoNonce` / `readSsoReturnUrl` / `encodeSsoRedirectResult` / `isAnonymousSession` | 主站：解析子站请求 + 编码回跳结果              |

握手失败原因 `SsoFailureReason`：`not_authenticated`（确认未登录，可清账号态）/ `timeout` / `popup_blocked` / `closed` / `invalid_request` / `not_configured` / `error`（后面这些是「没拿准」，**不要**当登出）。

---

## 安全

- **白名单只放第一方域名**——给第三方放行等于把账号钥匙送人。
- **一次一令 nonce**：redirect 用 sessionStorage 暂存、回跳校验，防 CSRF / 结果注入。
- **redirect 只在 fragment 传一次性票据**，不传 `refresh_token`。
- 票据是 mint-any-session 级能力的派生物，签发私钥按高敏密钥管理（控制台轮换、勿入日志/transcript）。

## License

MIT
