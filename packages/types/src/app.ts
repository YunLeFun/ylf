/**
 * 应用信息
 */
export interface YlfAppInfo {
  /**
   * 应用 ID
   */
  id: string
  /**
   * 应用主题色（十六进制，默认 #007AFF）
   *
   * 对齐 CloudBase apps 集合字段命名（原 color）。
   */
  themeColor: string
  /**
   * 应用 Logo 图片 URL（优先于 emoji 展示）
   *
   * 对齐 CloudBase apps 集合字段命名（原 icon）。
   */
  logo?: string
  /**
   * emoji
   *
   * logo 不存在时，emoji 替代 logo
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
   * 应用网址（对齐 CloudBase apps 集合字段命名，原 url）
   */
  websiteUrl: string
  /**
   * 应用描述
   */
  description?: string
  /**
   * 应用分类
   */
  category?: string
  /**
   * 评分（0-5）。
   *
   * 真实来源为评论系统聚合（reviewSummary）；此字段仅作列表展示的去规范化缓存，
   * 详情页一律以评论实时聚合为准。缺省表示暂无评分。
   */
  rating?: number
  /**
   * 评分人数（已发布评论数）。与 `rating` 同为评论聚合的去规范化缓存。
   * 列表据此判断「有真实评分」——为 0 / 缺省时不展示评分，避免出现写死的假分。
   */
  ratingCount?: number
  /**
   * 年龄分级
   */
  age?: string
  /**
   * 应用截图 URL 列表（详情页预览区展示真实截图；缺省回退占位面板）
   */
  screenshots?: string[]
  /**
   * 开发者标识（对应 CloudBase apps 集合 `ownerLogin`，通常为 GitHub 登录名）。
   * 用于「开发者主页」与「该开发者的其他 App」聚合。
   */
  developer?: string
  /**
   * 开发者展示名（中文名等）。缺省回退 GitHub 资料 name，再回退 developer 登录名。
   */
  developerName?: string
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
