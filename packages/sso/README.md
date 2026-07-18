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

## v2 安全流程

1. Consumer 顶层跳转到 `https://www.yunle.fun/auth/sso`，携带 HTTPS `targetOrigin`、同 origin `returnUrl` 和 128-bit nonce。
2. Provider 使用 `auth.getSession()`，检查 `{ data, error }`，要求 `data.session` 且拒绝 `user.is_anonymous`。
3. 已认证 Provider 调用 `sso-ticket` 的 `issueSsoCode`；云函数从当前调用上下文派生 uid，拒绝任何 `uid`/`subject` 输入。
4. Provider 在回跳 fragment 中只放 256-bit 一次性授权码和 nonce，不放 CloudBase ticket、access token 或 refresh token。
5. Consumer 从自身 origin 以 HTTPS 原子兑换授权码。服务端校验 Origin + nonce + TTL，并在事务中将授权码标为已使用。
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

startSsoRedirect()
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
const auth = app.auth

const redirect = consumeSsoRedirect()
if (redirect?.ok && 'code' in redirect) {
  await adoptSsoCode(auth, redirect.code, { nonce: redirect.nonce })
}

const { data, error } = await auth.getSession()
if (error || !data?.session || data.session.user?.is_anonymous) {
  throw new Error('SSO did not establish a verified session')
}
```

本地联调必须显式传 `allowHttpLocalhost: true`，且只放行 loopback；生产 API 默认拒绝所有 HTTP URL。

## 兼容通道

`requestSso` 的 popup/iframe 通道仍可用于兼容场景，但新接入优先顶层重定向。`adoptSession`、`adoptSsoTicket` 和直接转发主站 session 的方式已弃用；Drive 和 CMS 不得调用它们，也不得接收主站 refresh token。

## Provider 要求

- `targetOrigin` 必须命中服务端与页面端的同一第一方白名单。
- redirect 的 `returnUrl.origin` 必须与 `targetOrigin` 完全相等。
- nonce 必须是 32–128 位 base64url 字符；授权码必须包含 256-bit CSPRNG 熵。
- `issueSsoCode` 只能通过已认证 SDK 调用；`exchangeSsoCode` 只接受 HTTPS POST 和精确 Origin CORS。
- 兑换响应使用 `Cache-Control: no-store`、`Pragma: no-cache`、`Referrer-Policy: no-referrer`。
- `sso_login_codes` 是 server-only 集合；浏览器不可读写，过期/已消费记录由 worker 清理。

## License

MIT
