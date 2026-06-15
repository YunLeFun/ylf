// 子应用直接 `import { signInWithSso } from '@yunlefun/sso'` 即可拿到全部能力。
// Provider（主站桥接页）只需协议层，按需 `import { ... } from '@yunlefun/sso/protocol'`。
export * from './client'
export * from './native'
export * from './protocol'
