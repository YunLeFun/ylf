# @yunlefun/support-client

统一支持入口与应用内私密反馈 SDK。无框架依赖，使用原生 fetch；支持 Node 18.15+，新服务推荐受支持的 Node LTS。
版本 0.4.0 提供 `/feishu`、结构化联系方式和 `SupportApiError`。通过 npm 安装无需访问私有源码仓库：

```sh
pnpm add @yunlefun/support-client@^0.4.0
# 或 npm install @yunlefun/support-client@^0.4.0
```

包内只包含构建产物、类型声明、包元数据和本文档，无运行时依赖或应用凭据。
SDK 源码在 [YunLeFun/ylf](https://github.com/YunLeFun/ylf) 按 MIT 许可维护。Support 服务、业务数据及历史 GitHub Release 归档保持私有；公开 SDK 不改变 API 鉴权要求。
后续修改与版本发布统一在本仓库进行，发布流程见[发布指南](../../.github/workflows/RELEASING.md)。

## 跳转入口

现有 URL 构建 API 保持兼容。应用也可直接链接到
`https://support.yunle.fun/contact?product=cook` 或
`https://support.yunle.fun/feedback?product=cook`。支持 `www`、`drive`、`cms`、`advjs`、`cook`、`play`、`yunbox`。
不要在 URL 放邮箱、令牌、订单正文或其他私密内容。

```ts
import { buildSupportUrl } from '@yunlefun/support-client'

const url = buildSupportUrl({
  product: 'drive',
  intent: 'feedback',
  source: 'drive-web',
  context: { version: '1.0.0' },
})
```

## 应用内提交

浏览器提交给应用自己的同源服务端；应用服务端校验自己的会话、Origin、CSRF、输入和限流，
再调用 Support。私钥只存应用服务端 Secret，不能发送到浏览器。`/server` 导出仅支持 Node 条件。
用户 ID 必须取自已经验证的 YunLeFun 会话，不能接受浏览器传入的 UID。

```ts
import { createSupportServerClient } from '@yunlefun/support-client/server'

// 在应用已鉴权的服务端处理器内执行。
const support = createSupportServerClient({
  clientId: 'cook-web',
  keyId: '2026-10',
  privateKey: serverSecrets.supportPrivateKey,
  userId: verifiedSession.userId,
})
const receipt = await support.submitFeedback({
  productId: 'cook',
  category: 'problem', // problem | suggestion | other
  description: validatedForm.description, // 5–4000 字符
  contact: validatedForm.contact, // 选填的独立联系方式
  context: { version: appVersion, pageUrl: reviewedPageUrl },
}, submissionId) // 同一提交重试时保留同一 UUID 和正文
```

响应包含 `id`、`productId`、`status`、`createdAt`，并可附带 `ticketId` 和仅回传原提交者的 `ticketUrl`。访客链接含访问凭证，不能写日志或转发到看板。向用户显示编号；内容在 Support `/manage` 的产品私密队列处理，
不会自动发布到需求墙。上下文可选，只接受 `pageUrl`、`version`、`requestId`、`errorCode`、`source`；URL 的账号、密码、查询与 fragment 会移除。
不要把路径中的私密标识或请求正文作为上下文。应用内表单应允许用户检查或删除上下文。

请求超时为 15 秒，SDK 不自动重试。超时、503 或 409 并发冲突可用原幂等键和原正文重试，
每次调用会重新签发 assertion。不同正文重复使用幂等键会返回 `STATE_CONFLICT`。
429 `RATE_LIMITED` 应延迟并提示用户稍后再试，401 `AUTH_REQUIRED` 检查注册/密钥/时钟，
403 `FORBIDDEN` 检查产品范围；400 `INVALID_INPUT` 修改表单后使用新键。
从主入口或 `/server` 导入 `SupportApiError`，可用 `instanceof` 捕获 HTTP 错误并读取 `code`、`status`、`requestId`；原主入口 `SupportClientError` 仍为 URL 协议错误。诊断日志不要记录正文、访客链接或 JWT。

## 登记与轮换公钥

1. 应用生成 P-256/ES256 密钥对，私钥留在应用 Secret；把 public JWK 交给 Support 维护者。
2. 由 Support 维护者登记应用 clientId、可访问产品、`feedback:submit` scope 和带 kid 的 public JWK；访客接入须额外启用 `allowGuests`。注册配置仅在 Support 服务端维护。
3. 应用服务端从自己的已验证会话取得身份后提交，验证后台收到对应应用记录与回执，再开放入口。
   本版本提供 Support 接收端和 SDK；不会替其他仓库自动登记凭据或改造其表单。
4. 轮换时先加新公钥（最多 3 把），部署应用新私钥，等待旧 assertion 最长 60 秒后移除旧公钥。
   设置 `active: false` 可立即停用应用。客户端 ID 为小写字母开头、随后小写字母/数字/短横线，长度 3–64；
   用户 ID 为字母/数字开头，随后字母、数字、`_`、`-`，最长 128 字符。

非 Node 服务端可使用主入口 `createSupportClient({ createAssertion })`，自行实现 ES256 签名：
JWT header 为 `alg=ES256`、`typ=support-integration+jwt`、`kid`；claims 为 `iss=clientId`、`sub=userId`、
`aud=support-private-api`、`iat`、`exp`（最多 60 秒）、随机 `jti`、`scope=feedback:submit`，以及 SDK 回调提供的
`method`、`path`、`idempotencyKey` 和原始 UTF-8 `body` 的 SHA-256 十六进制 `bodyHash`。
Support 校验 nonce，重放同一 assertion 被拒绝。不要把请求重定向到其他地址，也不要设置浏览器 Origin。

管理委托另需 `feedback:manage` scope，且每次与 Support 当前员工产品权限求交集；此 SDK 不默认授予管理权限。

## 版本策略

0.1.0 保留原跳转 API，新增私密提交和独立服务端签名入口。向后不兼容的协议修改必须升级版本；
字段新增保持可选，服务端以明确 DTO 返回。从 0.4.0 开始在 npm 公开分发 SDK 构建产物，版本包不附带运行凭据；历史私有归档继续保留。

### 匿名应用内反馈（0.2.0）

对于已经允许未登录反馈的应用，服务端可以使用 `guestId` 代替 `userId`。
`guestId` 必须由服务端派生，例如随机设备标识的不可逆摘要；不能把客户端自报 UID 当作账号。
注册表需要显式设置 `allowGuests: true`。Support 将访客与应用 issuer 一起散列后保存，
记录为 `guest`；匿名凭证只能提交反馈，不能执行 `feedback:manage`。
原来的 `userId` API 和 0.1.0 客户端仍兼容。

```ts
const client = createSupportServerClient({
  clientId: 'cook-server',
  keyId: process.env.COOK_SUPPORT_KEY_ID!,
  privateKey: process.env.COOK_SUPPORT_PRIVATE_KEY!,
  guestId: serverDerivedGuestHash,
})
```

`/server` 和 `/feishu` 只在可信 Node 服务端加载。浏览器可使用主入口的 URL 工具；
私密提交必须经应用自己的同源后端签名，不能把私钥放入网页构建。
现有消费应用可以继续使用历史 GitHub Release 归档，或在各自接入验收后改用 npm 依赖。

## 可选飞书镜像（0.4.0）

`/feishu` 提供 `createFeishuTicketMirror`、`syncSupportTickets`、`projectTicketMirror`、
`DEFAULT_FEISHU_TICKET_FIELDS` 和 `TicketMirrorError`。同步来源使用 `/server` 的
`createSupportAgentClient`，单独登记 `tickets:read` 凭据，并与维护者当前产品权限求交集。

```ts
import { createFeishuTicketMirror, syncSupportTickets } from '@yunlefun/support-client/feishu'
import { createSupportAgentClient } from '@yunlefun/support-client/server'

const source = createSupportAgentClient({
  clientId: 'drive-mirror',
  keyId: 'current-key',
  privateKey: serverSecrets.supportReadPrivateKey,
  userId: verifiedMaintainerId,
})
const mirror = createFeishuTicketMirror({
  appId: serverSecrets.feishuAppId,
  appSecret: serverSecrets.feishuAppSecret,
  appToken: configuredBaseToken,
  tableId: configuredTableId,
})
const preview = await syncSupportTickets({ source, mirror, productId: 'drive' })
// 默认仅预览计数，不请求飞书；核对后显式传 dryRun: false 才写入。
```

目标表预先创建九列：`Support ID`、`工单编号`、`产品`、`状态`、`优先级`为文本，
`提交时间`、`更新时间`为日期，`工单链接`为超链接，`Support 版本`为数字。
可通过 `fields` 映射列名。仅同步这些元数据；正文、联系方式、内部备注、附件与访客令牌不会写入镜像。
默认每次处理一页、最多 20 条，`maxPages` 为 1–100；结果有 `nextCursor` 时传入下次调用继续。
同一目标串行运行，按稳定键创建或更新，不反向修改 Support。

实际飞书权限、目标表和调度由维护者配置；安装 SDK 不会自动创建资源、开启同步或发送通知。
