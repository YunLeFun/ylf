/**
 * Deprecated direct CloudBase ticket/session adoption helpers.
 *
 * New applications must use the authorization-code + PKCE exports from `@yunlefun/sso`.
 * This entry point exists only for a bounded migration window and must not be used by Drive or CMS.
 */
export {
  adoptSession,
  adoptSsoResult,
  adoptSsoTicket,
  requestSso,
  signInWithSso,
} from './client'
export type {
  SsoOptions,
  SsoSetSessionAuth,
} from './client'
export {
  isInYunleApp,
  requestSsoNative,
} from './native'
export type {
  NativeSsoOptions,
  YlfNativeBridge,
} from './native'
