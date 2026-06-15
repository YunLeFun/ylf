/**
 * 平台账户 / 支付相关类型（云乐坊会员 + 云币）
 *
 * www.yunle.fun（支付下单 / 充值）与 apps.yunle.fun（云居 App，账户 + 按次扣费 + iOS 内购）
 * 共用同一个 CloudBase 环境的 `account-api` / `wxpay-order` 云函数，两端共享此处类型与常量。
 *
 * 注意：价格/套餐常量的服务端真相源在 www 仓库 `functions/wxpay-order/lib/plans.js`（CJS 独立部署，
 * 无法直接 import 本包），修改 PLAN_PRICES / COIN_* 常量时必须同步该文件及其 lib 副本。
 */

/** 会员等级标识 */
export type MembershipLevel = 'basic'

/** 计费周期 */
export type BillingCycle = 'month' | 'year'

/** 套餐显示名称 */
export const PLAN_NAMES: Record<MembershipLevel, string> = {
  basic: '云乐坊会员',
}

/** 会员权益列表（两端权益介绍的唯一事实源，与 www content/2.pricing.yml 对齐） */
export const PLAN_FEATURES: Record<MembershipLevel, string[]> = {
  basic: [
    '用户数据同步',
    '收藏/历史记录',
  ],
}

/** 会员套餐价格表（单位：分），与 functions/.../lib/plans.js 的 PLAN_PRICES 同步 */
export const PLAN_PRICES: Record<MembershipLevel, Record<BillingCycle, number>> = {
  basic: { month: 1000, year: 10000 },
}

/** 云币汇率：1 云币 = 10 分（100 云币 = 10 元），与 lib/plans.js 的 COIN_RATE_FEN 同步 */
export const COIN_RATE_FEN = 10

/** 自定义充值云币数量下限（与 lib/plans.js 的 COIN_CUSTOM_MIN 同步） */
export const COIN_CUSTOM_MIN = 100

/** 自定义充值云币数量上限（与 lib/plans.js 的 COIN_CUSTOM_MAX 同步） */
export const COIN_CUSTOM_MAX = 100_000

/** 云币充值套餐标识 */
export type CoinPackId = 'coin_100' | 'coin_500' | 'coin_1000'

/** 云币充值套餐表：packId -> { amount(分), coin }，与 lib/plans.js 的 COIN_PACKS 同步 */
export const COIN_PACKS: Record<CoinPackId, { amount: number, coin: number }> = {
  coin_100: { amount: 1000, coin: 100 },
  coin_500: { amount: 5000, coin: 500 },
  coin_1000: { amount: 10000, coin: 1000 },
}

/** 账户全貌（account-api getAccount 返回） */
export interface AccountSnapshot {
  /** 云币余额 */
  coin: number
  membership: {
    isActive: boolean
    level: MembershipLevel | null
    expireAt: number | null
  }
}

/** 云币流水记录 */
export interface CoinTransaction {
  _id: string
  userId: string
  appId: string
  type: 'recharge' | 'consume' | 'refund' | 'gift'
  /** 正=入账，负=扣减 */
  amount: number
  balanceAfter: number
  refId: string
  meta?: Record<string, unknown>
  createdAt: number
}

/** 云币流水类型的展示名 */
export const COIN_TX_TYPE_NAMES: Record<CoinTransaction['type'], string> = {
  recharge: '充值',
  consume: '消费',
  refund: '退款',
  gift: '赠送',
}

/** 格式化云币数量 */
export function formatCoin(amount: number): string {
  return `${amount} 云币`
}

/** 格式化金额（分 -> 元） */
export function formatPrice(amountInCents: number): string {
  return `¥${(amountInCents / 100).toFixed(2)}`
}

/** 支付方式（iap = iOS App Store 内购） */
export type PayType = 'native' | 'jsapi' | 'h5' | 'iap'

/** 订单状态 */
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'closed' | 'refunded'

/** @deprecated 改用 MembershipLevel，保留别名兼容旧代码 */
export type PlanId = MembershipLevel

/** 订单类型：会员订阅 / 云币充值 */
export type OrderType = 'membership' | 'recharge_coin'

/** 订单记录 */
export interface OrderRecord {
  _id: string
  userId: string
  planId: PlanId
  billingCycle: BillingCycle
  /** 金额（分） */
  amount: number
  payType: PayType
  status: OrderStatus
  outTradeNo: string
  transactionId?: string
  /** Native 支付二维码链接 */
  codeUrl?: string
  /** H5 支付跳转链接 */
  h5Url?: string
  /** JSAPI 支付预付单 ID */
  prepayId?: string
  /** JSAPI 支付参数（前端调起支付用） */
  jsapiParams?: {
    appId: string
    timeStamp: string
    nonceStr: string
    package: string
    signType: string
    paySign: string
  }
  createdAt: number
  paidAt?: number
  updatedAt: number
}

/** 创建会员订单参数 */
export interface CreateMembershipOrderParams {
  orderType?: 'membership'
  /** 应用标识（多租户归属），如 'yunle' */
  appId: string
  /** 会员等级（兼容旧字段 planId） */
  level: MembershipLevel
  billingCycle: BillingCycle
  payType: PayType
  /** JSAPI 支付需要的微信 openid */
  wxOpenid?: string
}

/** 创建云币充值订单参数（packId 与 coin 二选一） */
export interface CreateRechargeOrderParams {
  orderType: 'recharge_coin'
  appId: string
  /** 预设充值套餐 */
  packId?: CoinPackId
  /** 自定义充值云币数量（金额由服务端按汇率计算） */
  coin?: number
  payType: PayType
  wxOpenid?: string
}

/** 创建订单参数 */
export type CreateOrderParams = CreateMembershipOrderParams | CreateRechargeOrderParams

/** 支付弹窗阶段 */
export type PaymentPhase = 'confirm' | 'paying' | 'success' | 'fail'

/** 下单返回结果 */
export interface CreateOrderResult {
  /** 数据库订单 ID。H5 跳转回来恢复时可能不可用，因此设为可选。 */
  orderId?: string
  outTradeNo: string
  payType: PayType
  /** Native 支付二维码链接 */
  codeUrl?: string
  /** H5 支付跳转链接 */
  h5Url?: string
  /** JSAPI 支付参数 */
  jsapiParams?: OrderRecord['jsapiParams']
}

/** 查询订单返回结果 */
export interface QueryOrderResult {
  status: OrderStatus
  transactionId?: string
  paidAt?: number
}
