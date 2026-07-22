// 子应用直接 `import { startSsoRedirect } from '@yunlefun/sso'` 使用授权码 + PKCE 流程。
// Provider 只需协议层；旧 session/ticket 采用能力只能从 `@yunlefun/sso/legacy` 显式导入。
export {
  adoptSsoCode,
  consumeSsoRedirect,
  startSsoRedirect,
  YLF_DEFAULT_SSO_EXCHANGE_URL,
  YLF_DEFAULT_SSO_ORIGIN,
} from './client'
export type {
  RedirectSsoOptions,
  SsoAdoptionAuth,
  SsoCodeExchangeOptions,
  SsoFetch,
} from './client'
export {
  buildSsoRequestUrl,
  deriveSsoPkceChallenge,
  encodeSsoRedirectResult,
  firstQueryValue,
  hasSsoRedirectResult,
  isAnonymousSession,
  isSecureSsoUrl,
  isSsoPkceVerifier,
  isSsoRedirectBoundToTarget,
  parseSsoRedirectResult,
  readSsoClientId,
  readSsoCodeChallenge,
  readSsoCodeChallengeMethod,
  readSsoMode,
  readSsoNonce,
  readSsoReturnUrl,
  readSsoTargetOrigin,
  SSO_QUERY_KEYS,
  SSO_REDIRECT_HASH_KEY,
} from './protocol'
export type {
  SsoFailureReason,
  SsoMode,
  SsoRedirectResult,
  SsoUrlSecurityOptions,
} from './protocol'
