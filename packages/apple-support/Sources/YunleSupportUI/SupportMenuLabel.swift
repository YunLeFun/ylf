import SwiftUI

/// Brand artwork bundled with the package so support menus also work offline.
public enum SupportBrand: String, CaseIterable {
    case wechat, github, x, bilibili

    public var image: Image {
        Image("support-" + rawValue, bundle: .module)
    }

    fileprivate var color: Color {
        switch self {
        case .wechat: return Color(red: 7 / 255, green: 193 / 255, blue: 96 / 255)
        case .bilibili: return Color(red: 251 / 255, green: 114 / 255, blue: 153 / 255)
        case .github, .x: return .primary
        }
    }
}

/// The leading symbol or brand mark for a support action.
public enum SupportMenuIcon {
    case system(String)
    case brand(SupportBrand)
}

/// A common label for Button, Link, NavigationLink and DisclosureGroup rows.
public struct SupportMenuLabel: View {
    private let title: String
    private let icon: SupportMenuIcon
    private let value: String?
    private let external: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.isEnabled) private var isEnabled

    public init(_ title: String, icon: SupportMenuIcon, value: String? = nil, external: Bool = false) {
        self.title = title
        self.icon = icon
        self.value = value
        self.external = external
    }

    public var body: some View {
        HStack(alignment: dynamicTypeSize.isAccessibilitySize ? .top : .center, spacing: 12) {
            leadingIcon
                .frame(width: 24, height: 24)
                .accessibilityHidden(true)
            if dynamicTypeSize.isAccessibilitySize, let value {
                VStack(alignment: .leading, spacing: 4) {
                    titleText
                    valueText(value)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                titleText
                Spacer(minLength: 8)
                if let value {
                    valueText(value)
                }
            }
            if external {
                Image(systemName: "arrow.up.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.secondary)
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
        .contentShape(Rectangle())
        .opacity(isEnabled ? 1 : 0.45)
        .accessibilityElement(children: .combine)
    }

    private var titleText: some View {
        Text(title).font(.body).foregroundStyle(Color.primary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func valueText(_ value: String) -> some View {
        Text(value).font(.subheadline).foregroundStyle(Color.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var leadingIcon: some View {
        switch icon {
        case .system(let name):
            Image(systemName: name)
                .font(.system(size: 20))
                .foregroundStyle(Color.accentColor)
        case .brand(let brand):
            brand.image
                .resizable().scaledToFit()
                .foregroundStyle(brand.color)
        }
    }
}

public extension View {
    /// Apply to the interactive row, keeping native Form separators and hit testing.
    func supportMenuRow() -> some View {
        frame(minHeight: 36)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
    }
}
