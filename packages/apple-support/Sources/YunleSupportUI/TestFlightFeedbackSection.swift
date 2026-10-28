import SwiftUI

/// Beta instructions and links, displayed only when the host confirms TestFlight distribution.
public struct TestFlightFeedbackSection: View {
    private let appName: String
    private let isTestFlight: Bool

    public init(appName: String, isTestFlight: Bool) {
        self.appName = appName
        self.isTestFlight = isTestFlight
    }

    public var body: some View {
        if isTestFlight {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text("使用测试版时截屏，打开系统截屏预览，选择“共享 Beta 版反馈”，填写问题说明后提交。")
                    Text("也可以打开 TestFlight，选择\(appName)，点“发送反馈”，再选择“包括截屏”。")
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
                Link(destination: URL(string: "https://support.yunle.fun/testflight")!) {
                    SupportMenuLabel("查看截图反馈指引", icon: .system("viewfinder"), external: true)
                }
                .supportMenuRow()
                .accessibilityIdentifier("feedback.testflight.guide")
                Link(destination: URL(string: "https://testflight.apple.com/")!) {
                    SupportMenuLabel("Apple 官方 TestFlight 指引", icon: .system("apple.logo"), external: true)
                }
                .supportMenuRow()
                .accessibilityIdentifier("feedback.testflight.official")
            } header: {
                Text("TestFlight 截图反馈")
            } footer: {
                Text("通过 TestFlight 提交的反馈会发送给 Apple 和开发者。提交前请遮挡截图中的个人信息。")
            }
            .accessibilityIdentifier("feedback.testflight.section")
        }
    }
}
