/**
 * 应用信息
 */
export interface YlfAppInfo {
  /**
   * 应用 ID
   */
  id: string
  /**
   * 应用颜色
   */
  color: string
  /**
   * 应用图标
   */
  icon?: string
  /**
   * emoji
   *
   * icon 不存在时，emoji 替代 icon
   */
  emoji: string
  /**
   * 应用名称
   */
  name: string
  /**
   * 应用唯一标识符（URL slug）
   */
  slug: string
  /**
   * 应用 URL
   */
  url: string
  /**
   * 应用描述
   */
  description?: string
  /**
   * 应用分类
   */
  category?: string
  /**
   * 评分
   */
  rating?: number
  /**
   * 下载量
   */
  downloads?: string
  /**
   * 应用大小
   */
  size?: string
  /**
   * 年龄分级
   */
  age?: string
  /**
   * 副标题（用于今日推荐等）
   */
  subtitle?: string
  /**
   * 标语（用于今日推荐等）
   */
  tagline?: string

  /**
   * 按次消费的云币数量（>0 表示付费应用）。
   *
   * 打开时扣除对应云币；云乐坊会员免扣（见 useOpenApp）。
   */
  coinCost?: number

  /**
   * 是否为会员专属应用。
   *
   * 为 true 时，仅云乐坊会员可打开；非会员将被引导去开通会员。
   */
  requiresMembership?: boolean

  /**
   * 回调
   */
  callback?: () => void
}
