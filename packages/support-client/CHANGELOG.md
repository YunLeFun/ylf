# Changelog

## 0.4.1

- 统一从公共 `YunLeFun/ylf` 通过 npm OIDC 发布，API 与 0.4.0 兼容。
- 发布验证容忍 npm 新版本处理延迟，按上限重试 registry 回装。

## 0.4.0

- 支持跨应用跳转、可信服务端签名提交、账号／访客和独立联系方式。
- 提供 `SupportApiError`、私密回执校验与仅限 Node 的可选飞书工单镜像。
- SDK 源码、合成测试和 MIT 许可迁入公共 ylf，Support 服务继续私有。
