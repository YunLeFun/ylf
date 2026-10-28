# ylf

YunLeFun 的公共 SDK 与 CLI monorepo，统一维护 `@yunlefun/*` 包。各包独立版本、独立发布，源码使用 MIT 许可；业务服务和生产凭据由各应用独立管理。

| 包                                                                        | 用途                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------- |
| [`@yunlefun/sso`](packages/sso)                                           | 跨站 SSO 客户端和协议                          |
| [`@yunlefun/server-session`](packages/server-session)                     | 服务端会话和 H3 帮助函数                       |
| [`@yunlefun/server-session-cloudbase`](packages/server-session-cloudbase) | CloudBase 会话存储适配器                       |
| [`@yunlefun/support-client`](packages/support-client)                     | 支持入口、私密反馈提交和可选飞书工单镜像       |
| [`YunleSupportUI`](packages/apple-support)                                | iOS/macOS 反馈菜单、品牌图标与 TestFlight 指引 |
| [`ylf`](packages/ylf)                                                     | 云乐坊 CLI                                     |

```sh
pnpm add @yunlefun/support-client@^0.4.0
```

SDK 发布使用 GitHub Actions 和 npm Trusted Publishing（OIDC），见[发布指南](.github/workflows/RELEASING.md)。Support 主服务与业务数据继续由私有仓库管理。

CLI 用户文档见 [`packages/ylf/README.md`](packages/ylf/README.md)，Pages 完整指南见 <https://wiki.yunle.fun/technical/frontend/cloud-storage/pages-hosting>。

## Todo

GitHub Actions CI for cargo publish & release.

- pnpm monorepo
