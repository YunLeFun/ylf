# 原生 App 接入统一支持中心

## 接入目标

新 App 通过共享原生容器使用同一套网页反馈、工单和帮助。产品登记与权限仍在服务器验证，URL 或 User-Agent 只提供显示上下文。

1. 在 Support 仓库 `apps/web/shared/support-products.ts` 登记产品 slug、名称、帮助入口和状态地址。该清单同时用于网站与服务端反馈校验；通知接收范围和维护者权限按实际产品独立配置。
2. 添加 `https://github.com/YunLeFun/ylf.git` 的固定、已验证 Swift Package revision，依赖 `YunleSupportUI`。
3. 在 App 中呈现 `SupportBrowser(configuration: SupportConfiguration(productID: "your-app", appName: "你的应用"))`。默认进入反馈表单；产品名和 Bundle 版本自动预填，用户可检查、删除上下文。
4. 使用已有账号衔接的 App 由宿主验证并注入 Support Cookie，负责切号、退出和撤销；没有该能力的 App 使用明确的访客流程，网页登录在独立 Safari 窗口中完成。
5. 先部署兼容的支持网站，再分发原生更新。使用合成数据验收提交、回执、回访和权限；附件与通知分别记录真实接通状态。

## 维护分工

- `SupportConfiguration`：生成对应产品与目标页的安全 URL，只包含公开产品、来源和版本。
- `SupportBrowser`：iOS 16+ 原生导航、内存 WebKit 会话、严格同源策略、外链与关闭提醒。
- Support `useSupportHost`：App 内显示模式与仅包含“是否有草稿/打开支持网页”的小消息协议，不交换凭据或反馈正文。
- Support 反馈页：表单、审阅上下文、会话内草稿和提交回执。
- Support 服务端：产品校验、身份、CSRF、私密工单、权限与运营通知。

## 页面约定

App 内页面保留“反馈、工单、帮助”，移除重复的网站页头和页脚；常规浏览器保留完整网站导航。键盘、安全区、系统主题和至少 16px 输入字号由网页与原生容器共同适配。

草稿仅保存描述与类型，按已验证身份和产品隔离。页面刷新与站内返回可恢复，切号清除原身份草稿，成功提交清除当前草稿；联系方式、诊断上下文、私密工单凭证不写入草稿存储。关闭容器后不保证保留，未发送时先确认。

当前没有跨原生 App 共享网页 Cookie，也没有把访问链接当作账号权限。TestFlight 截图反馈依然由 Apple 处理；公开帮助和 App 内指引保留其官方入口。

## 发布和验收边界

本轮提供代码接入，不代替真实签名、CloudKit 结构、TestFlight 分发或生产通知验收。截图附件上传需要新增服务端私密上传链路；回复通知与访客跨会话找回也需独立完成后再对用户承诺。
