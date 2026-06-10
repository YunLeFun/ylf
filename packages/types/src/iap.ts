import type { BillingCycle, CoinPackId, MembershipLevel } from './payment'

/**
 * iOS App Store 内购（IAP）商品映射
 *
 * apps.yunle.fun 的 Capacitor iOS 壳内不可使用微信支付（App Store 审核指南 3.1.1），
 * 云币包以「消耗型内购」、会员以「非续期订阅」上架。Product ID 与 App Store Connect
 * 中创建的商品一一对应；服务端入账云币数 / 会员周期按本映射查表，与 IAP 标价解耦。
 *
 * 修改时需同步 www 仓库 functions/wxpay-order/lib/plans.js 的 IAP_PRODUCTS 及其 lib 副本。
 */

/** IAP Product ID 前缀（与 iOS bundleId fun.yunle.apps 对应） */
export const IAP_PRODUCT_PREFIX = 'fun.yunle.apps.'

/** 云币包 -> 消耗型内购 Product ID */
export const IAP_COIN_PRODUCTS: Record<CoinPackId, string> = {
  coin_100: 'fun.yunle.apps.coin_100',
  coin_500: 'fun.yunle.apps.coin_500',
  coin_1000: 'fun.yunle.apps.coin_1000',
}

/** 会员（非续期订阅）Product ID：level.cycle -> productId */
export const IAP_MEMBER_PRODUCTS: Record<MembershipLevel, Record<BillingCycle, string>> = {
  basic: {
    month: 'fun.yunle.apps.member_month',
    year: 'fun.yunle.apps.member_year',
  },
}

/** IAP 商品反查结果 */
export type IapProductInfo
  = | { orderType: 'recharge_coin', packId: CoinPackId }
    | { orderType: 'membership', level: MembershipLevel, billingCycle: BillingCycle }

/** 由 productId 反查业务商品（未知商品返回 null） */
export function resolveIapProduct(productId: string): IapProductInfo | null {
  for (const [packId, id] of Object.entries(IAP_COIN_PRODUCTS)) {
    if (id === productId)
      return { orderType: 'recharge_coin', packId: packId as CoinPackId }
  }
  for (const [level, cycles] of Object.entries(IAP_MEMBER_PRODUCTS)) {
    for (const [cycle, id] of Object.entries(cycles)) {
      if (id === productId)
        return { orderType: 'membership', level: level as MembershipLevel, billingCycle: cycle as BillingCycle }
    }
  }
  return null
}

/** App 内可购买的全部 Product ID（getProducts 拉取用） */
export const IAP_ALL_PRODUCT_IDS: string[] = [
  ...Object.values(IAP_COIN_PRODUCTS),
  ...Object.values(IAP_MEMBER_PRODUCTS).flatMap(cycles => Object.values(cycles)),
]
