# YunleSupportUI

云乐坊、云食册和云生共用的 SwiftUI 支持界面。最低支持 iOS 16 / macOS 13，以根目录 `Package.swift` 作为远程 Swift Package 入口。

模块提供菜单、TestFlight 指引和 iOS App 内网页容器。表单、工单和帮助由支持网站统一维护；宿主继续管理原生账号、授权与诊断日志，不依赖安装云乐坊 App。

## 接入

XcodeGen 在 `packages` 中添加 `https://github.com/YunLeFun/ylf.git`，固定已验证的提交，并在目标的依赖中选择 `YunleSupportUI` 产品；三个 App 应同步升级这个提交。

```swift
import YunleSupportUI

Link(destination: URL(string: "https://support.yunle.fun/")!) {
    SupportMenuLabel("支持中心", icon: .system("questionmark.circle"), external: true)
}
.supportMenuRow()
```

`SupportMenuLabel` 使用统一 24pt 图标列、12pt 图文间距、36pt 最小内容高度；`supportMenuRow()` 为原生 Form/List 行设置上下各 10pt、左右各 16pt 的内边距。默认单行菜单为 56pt，标题或辅助字号需要更多空间时自然增高。保留系统分隔线、Button/Link/NavigationLink 语义和 VoiceOver 文案，不用固定高度裁剪文字。

`SupportSocialSection(openWebsite:copyOfficialAccount:)` 共用公众号和社交网站条目，调用方负责打开页面及复制名称。公众号名称作为行内次要信息显示，辅助字号改为上下排列。

`SupportMenuDetail.value` 用于账号等短值，`SupportMenuDetail.subtitle` 用于菜单说明；副标题始终在标题下方。带说明的帮助菜单与普通单行操作共用图标列和行距规则，不为追求等高而截断内容。

`TestFlightFeedbackSection(appName:isTestFlight:)` 接受 App 解析出的分发状态。调用方在稳定的父视图 `.task` 中使用 `await TestFlightDistribution.current()`；不要把任务挂在可能为空的指引内容上。App Store、调试版、模拟器和带本地描述文件的构建均不显示指引。

## 完整支持页面（iOS）

```swift
import YunleSupportUI

.sheet(isPresented: $showingSupport) {
    SupportBrowser(configuration: SupportConfiguration(
        productID: "cook",
        appName: "云食册"
    ))
}
```

默认直达 `/contact`，自动带入 Bundle 版本与构建号，供用户检查后提交。可指定 `destination: .help`、`.tickets` 或 `.roadmap`。产品标识使用稳定的小写 slug，需先在 Support 的 `apps/web/shared/support-products.ts` 登记产品；新增 iOS App 不需要修改 SDK 的产品枚举。完整接入说明见 [原生支持接入](../../docs/guide/native-support.md)。

容器统一提供完成/返回/重新载入、加载与失败状态、外链打开和未发送草稿的关闭提示。每次呈现使用隔离的内存 WebKit 数据存储，关闭不保证恢复网页会话；网页草稿只在当前会话内恢复，不保存联系方式，不承诺跨 App 或重启后的历史。

宿主已验证 Support 会话时，可用 `SupportBrowser(url:title:cookies:)` 打开工单或其他页面。仅同源、Secure、HttpOnly、根路径的两种 Support Cookie 会进入容器；宿主须在切号时以 `.id(identityGeneration)` 重建、关闭页面并撤销原会话。不会把原生 token 放入网页或 URL，也不会自动把网页登录认作宿主登录。

没有注入会话时，访客可直接反馈。用户选择登录会在 App 内的 Safari 窗口从完整 Support 页面开始；登录请求、校验器和回调都留在该窗口，随后在那里继续工单操作，不声称将会话同步回原容器。旧网站尚未支持 `/2` 时应先部署网站，再分发 App。

`origin:` 只用于明确指定的自托管环境和隔离验收；默认始终为正式 Support。只允许 HTTPS 或 HTTP 回环地址，并按实际 origin 限制顶层导航、消息与 Cookie，不接受 URL 中的账号密码。生产 App 不应从远端或用户输入设置 origin。

截图附件上传和回复通知属于服务端能力，当前容器没有提供虚假的上传或推送按钮，按支持中心对应链路独立接入和验收。

## 图标来源

- GitHub：从 [GitHub 官方品牌工具包](https://brand.github.com/foundations/logo) 的 `GitHub_Logos.zip` 使用 `GitHub_Invertocat_Black.svg`。黑白显示随系统主题调整。
- 微信：复用云食册已有的微信双气泡品牌矢量，来源为 [Simple Icons 的 WeChat 图标](https://github.com/simple-icons/simple-icons/blob/develop/icons/wechat.svg)；形状参照[微信官方品牌资源](https://wechat.design/brand/)。
- X、哔哩哔哩：使用 [Simple Icons](https://github.com/simple-icons/simple-icons) 的 `x.svg`、`bilibili.svg` 品牌矢量（CC0），而非系统通用图标。相关品牌分别见 [X 品牌指引](https://about.x.com/content/dam/about-twitter/x/brand-toolkit/x-brand-guidelines.pdf)和[哔哩哔哩](https://www.bilibili.com/)。

资源随 Swift Package 离线打包，不在用户打开反馈页时请求第三方图标服务。品牌商标权归各自所有者，SDK 的 MIT 许可不重新许可这些商标。

## 验证

在仓库根目录运行 `swift test`，可验证 TestFlight 判定的四组行为。三个 App 还需分别执行原生构建，并通过小屏、深浅色与辅助字号检查集成后的布局。
