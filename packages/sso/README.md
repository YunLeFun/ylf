# @yunlefun/sso

云乐坊第一方应用的跨站身份联邦。主站确认用户身份，子应用建立自己的 CloudBase 临时会话；应用自己的长期登录态由 `@yunlefun/server-session` 管理。

> 仅用于受控的第一方 origin。面向第三方产品应使用标准 OAuth/OIDC 授权码流程。

## 职责边界

| 组件                       | 负责                                                                   | 不负责                                     |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| `@yunlefun/sso`            | 顶层重定向/受信宿主授权、PKCE/nonce 绑定、临时身份采用、BFF 双证明校验 | Drive/CMS cookie、设备列表、撤销、应用授权 |
| `www.yunle.fun`            | 从当前已认证调用上下文派生 uid，签发并原子消费一次性授权码             | 接受调用者传入 uid；向子站发送主站 session |
| CloudBase Auth             | 官方 `signInWithCustomTicket` 身份证明                                 | Drive/CMS 的长期应用会话                   |
| `@yunlefun/server-session` | 256-bit opaque cookie、哈希持久化、过期、轮换、撤销、CSRF              | 跨站身份联邦                               |

SSO 与 server-session 因此不会重复：前者回答“这是谁”，后者回答“这个应用是否仍允许这台设备保持登录”。

## 为什么使用顶层 redirect

隐藏 iframe 依赖第三方 Cookie 或跨站存储可见性，popup 又依赖浏览器保留 opener 与原发起页面；
Safari ITP、存储分区、微信等移动端 WebView、系统浏览器切换和 popup 拦截都可能破坏这些前提。
典型表现就是 Provider 已完成登录，却无法再找到等待结果的 Consumer 页面。

顶层 redirect 让 Provider 与 Consumer 的每一跳都运行在各自的第一方上下文中，且不要求两个页面
同时存活。Consumer 仅在当前 tab 的 `sessionStorage` 保存 nonce 和 PKCE verifier；回跳 URL fragment
只携带短时、一次性的授权码。即使授权码被截获，没有 verifier 也无法兑换，且消费后不能重放。

因此普通 Web 使用 `startSsoRedirect()`。受控的云乐坊原生容器可通过
`@yunlefun/sso/browser` 请求同样绑定 nonce + PKCE 的一次性授权码；它不是通用第三方 bridge，
不会传递 Apps 的 access token、refresh token 或 session。隐藏 iframe、popup、session 转发
和 legacy 子路径仍不受支持。

## v3 安全流程

1. Consumer 生成 256-bit PKCE verifier，仅保存在当前 tab 的 `sessionStorage`；顶层跳转携带公开 `client_id`、显式 scope、S256 challenge、已精确登记的 HTTPS `redirect_uri` 和 256-bit nonce。
2. Provider 使用 `auth.getSession()`，检查 `{ data, error }`，要求 `data.session` 且拒绝 `user.is_anonymous`。
3. 已认证 Provider 调用 `sso-ticket` 的 `issueSsoCode`；云函数从当前调用上下文派生 uid，拒绝任何 `uid`/`subject` 输入。
4. Provider 在回跳 fragment 中只放 256-bit 一次性授权码、nonce 和 `iss`；Consumer 校验预期 issuer，防止 production/development mix-up。fragment 不放 CloudBase ticket、access token 或 refresh token。
5. Consumer 从自身 origin 以 HTTPS 原子兑换授权码。服务端校验 client ID + issuer environment + Origin + redirect URI + scope + policy fingerprint + nonce + PKCE + TTL，并在事务中将授权码标为已使用。
6. 兑换响应只返回短暂 CloudBase custom ticket 与绑定同一交易的签名身份断言；Consumer 立即把 ticket 交给官方 `signInWithCustomTicket(getTicket)`。
7. Consumer 用 `auth.getSession()` 验证真实非匿名 session，将 access token + 签名断言作为双重一次性证明交给应用 BFF 换取 host-only opaque session，然后清除临时 CloudBase 会话。

授权码只保存 SHA-256 标识，默认 60 秒失效，并且只能成功消费一次。CloudBase custom-login 私钥仅存在于受管函数 secret/env 中。

## Consumer 接入

```bash
pnpm add @yunlefun/sso
```

登录按钮发起顶层重定向：

```ts
import { startSsoRedirect } from '@yunlefun/sso'

await startSsoRedirect({
  clientId: 'cms-web',
  scope: ['identity:bootstrap'],
  redirectUri: 'https://cms.yunle.fun/',
})
```

需要让 Provider 明确展示当前账号并提供换号入口时，使用标准 OAuth/OIDC
交互提示；它只影响 Provider UI，不进入授权码、回跳结果或身份断言：

```ts
await startSsoRedirect({
  clientId: 'cms-web',
  scope: ['identity:bootstrap'],
  redirectUri: 'https://cms.yunle.fun/',
  prompt: 'select_account',
})
```

应用启动时消费结果；在原生容器中也可优先请求一次静默授权：

```ts
import { consumeSsoRedirect } from '@yunlefun/sso'
import {
  adoptSsoIdentityProof,
  requestHostSsoAuthorization,
} from '@yunlefun/sso/browser'

const authorization = await requestHostSsoAuthorization({
  clientId: 'cms-web',
  scope: ['identity:bootstrap'],
  redirectUri: 'https://cms.yunle.fun/',
  // 显式点击登录时让可信宿主 UI 确认当前账号；静默恢复时省略。
  prompt: 'consent',
}) ?? consumeSsoRedirect()

if (authorization?.ok) {
  // auth 必须是隔离、memory-only、persistence: 'none' 的 CloudBase 实例。
  const proof = await adoptSsoIdentityProof(auth, authorization, {
    exchangeUrl: 'https://api.yunle.fun/sso-ticket',
  })
  await fetch('/api/session/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(proof),
  })
  await auth.signOut()
}
```

BFF 复用相同的双证明校验，再按应用策略创建自己的 opaque session：

```ts
import { verifySsoIdentityProof } from '@yunlefun/sso/server'

const identity = await verifySsoIdentityProof(proof, {
  cloudbaseEnvId: 'yunlefun-8g7ybcxc7345c490',
  appId: 'cms',
  clientId: 'cms-web',
  issuer: 'https://www.yunle.fun',
  jwksUrl: 'https://api.yunle.fun/sso-ticket',
})
```

`@yunlefun/sso/browser` 不负责创建 CloudBase 实例或长期 cookie；
`@yunlefun/sso/server` 不负责应用 allowlist、角色、设备策略和错误文案。

本地 Web 联调也必须使用 Registry 中登记的精确 HTTPS Origin 和 redirect URI，例如
`https://cms.yunle.localhost:3443/`。production issuer 不接受 development 回跳。

## 已删除的旧表面

`requestSso`、`signInWithSso`、`requestSsoNative`、`adoptSession`、`adoptSsoTicket`
以及 `@yunlefun/sso/legacy` 均已删除。Consumer 不得接收或保存主站 access token、
refresh token、session，也不得把 custom ticket 暴露到 SDK 回调之外。

## 可选注册来源（0.7.0）

`startSsoRedirect`、`buildSsoRequestUrl` 和 `requestHostSsoAuthorization` 接受可选
`acquisition: { version: 1, firstTouch, registerTouch }`。每个 touch 包含
`capturedAt`、`landingHost`、`landingPath`、`referrerHost`、`utmSource`、`utmMedium`、`utmCampaign`。
Consumer 应在首次落地时保存来源，在认证开始时读取同一份快照；OAuth/SSO 回调不应重新采集。

根入口导出 `readAcquisitionContext`、`sanitizeAcquisitionContext`、
`encodeAcquisitionContext` 和 `decodeAcquisitionContext`。编码结果是 UTF-8 JSON，
通过 `URLSearchParams` 写入 `acquisition` query；读取时传入 `searchParams.get()` 的结果，
不再执行 `decodeURIComponent`。完整 JSON 最大 4096 字节；域名最长 253、路径最长 256、UTM 最长 120。
只保留白名单字段，路径去查询/hash，域名与 UTM 拒绝凭证格式和控制字符。
畸形来源会忽略，原有 nonce、issuer、Registry 和 PKCE 校验仍正常执行。

来源在 Consumer 的事务和验证成功的回调中保留；它是客户端上报的分析数据，
不能参与授权、判定是否新账号或覆盖服务端解析的应用 ID。Provider 自行完成注册确认、
私有来源持久化以及按 UID 去重。旧 Consumer 不传该字段仍可使用。

## Provider 要求

- Provider 页面只做协议语法和同源回跳检查；`sso-ticket` 的版本化 Client Registry 是唯一授权真源。
- `client_id` 是公开标识而不是凭据；Registry 必须把它绑定到 issuer environment、精确 HTTPS Origin 和精确 redirect URI。
- 完整 `redirect_uri` 必须与注册值精确匹配，且其 Origin 必须等于发起 Consumer 的 Origin。
- nonce 必须是 32–128 位 base64url 字符；授权码必须包含 256-bit CSPRNG 熵；授权码必须绑定 S256 PKCE challenge。
- `issueSsoCode` 只能通过已认证 SDK 调用；`exchangeSsoCode` 只接受 HTTPS POST 和精确 Origin CORS。
- 兑换响应使用 `Cache-Control: no-store`、`Pragma: no-cache`、`Referrer-Policy: no-referrer`。
- `sso_login_codes` 与 `sso_security_limits` 是 server-only 集合；浏览器不可读写，过期记录由不可公网调用的定时 worker 清理。

## License

MIT
