import Foundation
import SwiftUI

/// Shared public social destinations; the host owns navigation and clipboard effects.
public struct SupportSocialSection: View {
    private let openWebsite: (URL) -> Void
    private let copyOfficialAccount: (String) -> Void
    private let officialAccount = "云乐坊工作室"

    public init(openWebsite: @escaping (URL) -> Void, copyOfficialAccount: @escaping (String) -> Void) {
        self.openWebsite = openWebsite
        self.copyOfficialAccount = copyOfficialAccount
    }

    public var body: some View {
        Section("社交媒体") {
            Button { copyOfficialAccount(officialAccount) } label: {
                SupportMenuLabel("微信公众号", icon: .brand(.wechat), detail: .value(officialAccount))
            }
            .supportMenuRow()
            .accessibilityHint("复制公众号名称，在微信中搜索")
            .accessibilityIdentifier("support.wechat-official.copy")
            website("GitHub", value: "YunLeFun", icon: .brand(.github), url: "https://github.com/yunlefun", id: "github")
            website("X", value: "@yunlefun", icon: .brand(.x), url: "https://x.com/yunlefun", id: "x")
            website("哔哩哔哩", value: officialAccount, icon: .brand(.bilibili), url: "https://space.bilibili.com/yunlefun", id: "bilibili")
            website("云乐坊官网", icon: .system("globe"), url: "https://www.yunle.fun", id: "website")
            website("云乐坊工作室", icon: .system("building.2"), url: "https://studio.yunle.fun", id: "studio")
        }
    }

    private func website(_ title: String, value: String? = nil, icon: SupportMenuIcon, url: String, id: String) -> some View {
        Button { openWebsite(URL(string: url)!) } label: {
            SupportMenuLabel(title, icon: icon, detail: value.map { .value($0) }, external: true)
        }
        .supportMenuRow()
        .accessibilityIdentifier("support.social." + id)
    }
}
