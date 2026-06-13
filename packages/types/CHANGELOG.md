# @yunlefun/types Changelog

## 0.2.0

`YlfAppInfo` 调整（配合 apps.yunle.fun 应用详情改版：应用本质是网站，按网页应用而非原生 App 描述）。

### Breaking

- **移除** `downloads`、`size`：网站类应用无「下载量 / 体积」概念，且原值多为运营预设的假数据。消费方应停止读取（已确认 apps 与 www 均不再使用）。

### Added

- `screenshots?: string[]`：应用截图 URL 列表（详情页预览区真实截图，缺省回退占位面板）。
- `developer?: string`：开发者标识（对应 CloudBase `apps.ownerLogin`，通常为 GitHub 登录名），用于开发者主页与「该开发者的其他 App」聚合。
- `developerName?: string`：开发者展示名（中文名等），缺省回退 GitHub 资料 `name` 再回退 `developer`。
- `ratingCount?: number`：评分人数（已发布评论数），与 `rating` 同为评论聚合的去规范化缓存。

### Changed

- `rating` 文档澄清：仅作列表展示的去规范化缓存，真实来源为评论系统聚合（`reviewSummary`）；详情页一律以评论实时聚合为准，缺省表示暂无评分。

## 0.1.0

www 完整支付类型/常量（PayType 扩 `iap`、PLAN_PRICES、COIN_PACKS 等）+ PLAN_FEATURES + formatPrice + iap.ts（IAP 商品映射）。

## 0.0.2

`url` 重命名为 `websiteUrl`，对齐 CloudBase `apps` 集合字段命名。

## 0.0.1

首次发布：`YlfAppInfo` 与支付/账户核心类型。
