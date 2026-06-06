/**
 * 平台账户 / 支付相关类型（云乐坊会员 + 云币）
 *
 * www.yunle.fun（支付下单 / 充值）与 apps.yunle.fun（云居 App，只读账户 + 按次扣费）
 * 共用同一个 CloudBase 环境的 `account-api` 云函数，两端共享此处类型。
 *
 * 注意：完整的下单 / JSAPI / 订单类型仍保留在 www 仓库内（App 端用不到），
 * 此处只收敛两端都需要的「账户全貌 + 流水 + 会员等级」核心子集。
 */

/** 会员等级标识 */
export type MembershipLevel = 'basic'

/** 计费周期 */
export type BillingCycle = 'month' | 'year'

/** 套餐显示名称 */
export const PLAN_NAMES: Record<MembershipLevel, string> = {
  basic: '云乐坊会员',
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
