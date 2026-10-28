import Foundation

/// Destinations shared by native apps and the Support website.
public enum SupportWebDestination: String, Sendable {
    case feedback = "/contact"
    case help = "/help"
    case tickets = "/tickets"
    case roadmap = "/roadmap"
}

/// Public product context only. Credentials and feedback text never belong in a Support URL.
public struct SupportConfiguration: Sendable {
    public let productID: String
    public let appName: String
    public let version: String?
    public let supportOrigin: URL
    public static let origin = URL(string: "https://support.yunle.fun")!

    public init(productID: String, appName: String, version: String? = nil, bundle: Bundle = .main, origin: URL = Self.origin) {
        self.supportOrigin = origin
        self.productID = productID
        self.appName = appName
        let release = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        self.version = version ?? release.map { $0 + (build.map { "+" + $0 } ?? "") }
    }

    /// A new product must also be registered by the Support server before submitting feedback.
    public func url(for destination: SupportWebDestination = .feedback) -> URL? {
        guard Self.validOrigin(supportOrigin), productID.range(of: "^[a-z][a-z0-9-]{0,47}$", options: .regularExpression) != nil else { return nil }
        var components = URLComponents(url: supportOrigin, resolvingAgainstBaseURL: false)!
        components.path = destination.rawValue
        var query = [URLQueryItem(name: "product", value: productID)]
        if destination == .feedback || destination == .help {
            query.append(URLQueryItem(name: "source", value: productID + "-ios"))
            if let version, version.range(of: "^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$", options: .regularExpression) != nil {
                query.append(URLQueryItem(name: "appVersion", value: version))
            }
        }
        components.queryItems = query
        return components.url
    }

    static func allows(_ url: URL, origin: URL = Self.origin) -> Bool {
        validOrigin(origin) && url.scheme == origin.scheme && url.host == origin.host
            && (url.port ?? (url.scheme == "https" ? 443 : 80)) == (origin.port ?? (origin.scheme == "https" ? 443 : 80))
            && url.user == nil && url.password == nil
    }

    private static func validOrigin(_ url: URL) -> Bool {
        let local = url.scheme == "http" && ["localhost", "127.0.0.1", "[::1]"].contains(url.host ?? "")
        return (url.scheme == "https" || local) && url.host != nil && url.user == nil && url.password == nil
            && ["", "/"].contains(url.path) && url.query == nil && url.fragment == nil
    }

    static func allows(_ cookie: HTTPCookie, origin: URL = Self.origin) -> Bool {
        cookie.domain == origin.host && cookie.path == "/" && cookie.isSecure && cookie.isHTTPOnly
            && ["__Host-ylf-support-session", "__Host-ylf-support-guest"].contains(cookie.name)
            && (cookie.expiresDate.map { $0 > Date() } ?? true)
    }
}
