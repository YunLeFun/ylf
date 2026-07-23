# @yunlefun/sso

云乐坊第一方应用的跨站身份联邦。主站确认用户身份，子应用建立自己的 CloudBase 临时会话；应用自己的长期登录态由 `@yunlefun/server-session` 管理。

> 仅用于受控的第一方 origin。面向第三方产品应使用标准 OAuth/OIDC 授权码流程。

## 职责边界

| 组件                       | 负责                                                                                 | 不负责                                     |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| `@yunlefun/sso`            | 顶层重定向、origin/return URL/nonce 绑定、一次性授权码、CloudBase custom ticket 采用 | Drive/CMS cookie、设备列表、撤销、应用授权 |
| `www.yunle.fun`            | 从当前已认证调用上下文派生 uid，签发并原子消费一次性授权码                           | 接受调用者传入 uid；向子站发送主站 session |
| CloudBase Auth             | 官方 `signInWithCustomTicket` 身份证明                                               | Drive/CMS 的长期应用会话                   |
| `@yunlefun/server-session` | 256-bit opaque cookie、哈希持久化、过期、轮换、撤销、CSRF                            | 跨站身份联邦                               |

SSO 与 server-session 因此不会重复：前者回答“这是谁”，后者回答“这个应用是否仍允许这台设备保持登录”。

## 为什么使用顶层 redirect

隐藏 iframe 依赖第三方 Cookie 或跨站存储可见性，popup 又依赖浏览器保留 opener 与原发起页面；
Safari ITP、存储分区、微信等移动端 WebView、系统浏览器切换和 popup 拦截都可能破坏这些前提。
典型表现就是 Provider 已完成登录，却无法再找到等待结果的 Consumer 页面。

顶层 redirect 让 Provider 与 Consumer 的每一跳都运行在各自的第一方上下文中，且不要求两个页面
同时存活。Consumer 仅在当前 tab 的 `sessionStorage` 保存 nonce 和 PKCE verifier；回跳 URL fragment
只携带短时、一次性的授权码。即使授权码被截获，没有 verifier 也无法兑换，且消费后不能重放。

因此 `startSsoRedirect()` 是唯一登录入口。v0.5 不再发布隐藏 iframe、popup、session
转发、原生 bridge 或 legacy 子路径。

## v3 安全流程

1. Consumer 生成 256-bit PKCE verifier，仅保存在当前 tab 的 `sessionStorage`；顶层跳转携带公开 `client_id`、显式 scope、S256 challenge、已精确登记的 HTTPS `redirect_uri` 和 256-bit nonce。
2. Provider 使用 `auth.getSession()`，检查 `{ data, error }`，要求 `data.session` 且拒绝 `user.is_anonymous`。
3. 已认证 Provider 调用 `sso-ticket` 的 `issueSsoCode`；云函数从当前调用上下文派生 uid，拒绝任何 `uid`/`subject` 输入。
4. Provider 在回跳 fragment 中只放 256-bit 一次性授权码、nonce 和 `iss`；Consumer 校验预期 issuer，防止 production/development mix-up。fragment 不放 CloudBase ticket、access token 或 refresh token。
5. Consumer 从自身 origin 以 HTTPS 原子兑换授权码。服务端校验 client ID + issuer environment + Origin + redirect URI + scope + policy fingerprint + nonce + PKCE + TTL，并在事务中将授权码标为已使用。
6. 兑换响应只返回短暂 CloudBase custom ticket；Consumer 立即交给官方 `signInWithCustomTicket(getTicket)`。
7. Consumer 用 `auth.getSession()` 验证真实非匿名 session，将 access token 作为一次性证明交给应用 BFF 换取 host-only opaque session，然后清除临时 CloudBase 会话。

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

应用启动时消费结果并兑换：

```ts
import cloudbase from '@cloudbase/js-sdk'
import { adoptSsoCode, consumeSsoRedirect } from '@yunlefun/sso'

const app = cloudbase.init({
  env: 'yunlefun-8g7ybcxc7345c490',
  region: 'ap-shanghai',
  accessKey: '<publishable-key>',
  auth: { detectSessionInUrl: true },
})
const auth = app.auth({ persistence: 'local' })

const redirect = consumeSsoRedirect()
if (redirect?.ok) {
  await adoptSsoCode(auth, redirect, {
    exchangeUrl: 'https://api.yunle.fun/sso-ticket',
  })
}

const { data, error } = await auth.getSession()
if (error || !data?.session || data.session.user?.is_anonymous) {
  throw new Error('SSO did not establish a verified session')
}
```

本地 Web 联调也必须使用 Registry 中登记的精确 HTTPS Origin 和 redirect URI，例如
`https://cms.yunle.localhost:3443/`。production issuer 不接受 development 回跳。

## 已删除的旧表面

`requestSso`、`signInWithSso`、`requestSsoNative`、`adoptSession`、`adoptSsoTicket`
以及 `@yunlefun/sso/legacy` 均已删除。Consumer 不得接收或保存主站 access token、
refresh token、session，也不得把 custom ticket 暴露到 SDK 回调之外。

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
