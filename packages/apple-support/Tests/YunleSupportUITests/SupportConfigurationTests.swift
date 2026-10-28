import Foundation
import XCTest
@testable import YunleSupportUI

final class SupportConfigurationTests: XCTestCase {
    func testNewProductNeedsNoHardCodedClientEnumeration() throws {
        let url = try XCTUnwrap(SupportConfiguration(productID: "future-app", appName: "新应用", version: "1.2.3+4").url())
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/contact")
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(query, ["product": "future-app", "source": "future-app-ios", "appVersion": "1.2.3+4"])
        let help = SupportConfiguration(productID: "cook", appName: "云食册", version: "2.0.0+9").url(for: .help)!
        XCTAssertTrue(help.absoluteString.contains("appVersion=2.0.0+9"))
    }
    func testInvalidConfigurationCannotInjectAURLOrPrivateContext() {
        XCTAssertNil(SupportConfiguration(productID: "../cook?token=secret", appName: "App").url())
        let url = SupportConfiguration(productID: "cook", appName: "App", version: "secret token").url()!
        XCTAssertFalse(url.absoluteString.contains("secret"))
        XCTAssertEqual(SupportConfiguration(productID: "cook", appName: "App").url(for: .tickets)?.path, "/tickets")
    }
    func testOriginCannotBeEscapedByCredentialsPortsOrSimilarDomains() {
        for raw in ["http://support.yunle.fun/", "https://support.yunle.fun.evil.test/", "https://evil.test/", "https://user@support.yunle.fun/", "https://support.yunle.fun:444/"] {
            XCTAssertFalse(SupportConfiguration.allows(URL(string: raw)!), raw)
        }
        XCTAssertTrue(SupportConfiguration.allows(URL(string: "https://support.yunle.fun/tickets/test#access=private")!))
    }
    func testExplicitLoopbackOriginIsIsolatedFromProductionAndOtherPorts() throws {
        let origin = URL(string: "http://127.0.0.1:4173")!
        let url = try XCTUnwrap(SupportConfiguration(productID: "cook", appName: "App", origin: origin).url())
        XCTAssertTrue(SupportConfiguration.allows(url, origin: origin))
        XCTAssertFalse(SupportConfiguration.allows(url))
        XCTAssertFalse(SupportConfiguration.allows(URL(string: "http://127.0.0.1:4174/")!, origin: origin))
        XCTAssertNil(SupportConfiguration(productID: "cook", appName: "App", origin: URL(string: "http://example.com")!).url())
        XCTAssertNil(SupportConfiguration(productID: "cook", appName: "App", origin: URL(string: "https://support.yunle.fun/?secret=x")!).url())
    }
    func testOnlySecureHostScopedSupportCookiesCanCrossIntoTheBrowser() throws {
        func cookie(_ overrides: [HTTPCookiePropertyKey: Any] = [:]) throws -> HTTPCookie {
            var properties: [HTTPCookiePropertyKey: Any] = [.name: "__Host-ylf-support-session", .value: "test-only", .domain: "support.yunle.fun", .path: "/", .secure: "TRUE", HTTPCookiePropertyKey("HttpOnly"): "TRUE"]
            properties.merge(overrides) { _, new in new }
            if overrides[.secure] as? String == "FALSE" { properties.removeValue(forKey: .secure) }
            return try XCTUnwrap(HTTPCookie(properties: properties))
        }
        XCTAssertTrue(SupportConfiguration.allows(try cookie()))
        XCTAssertFalse(SupportConfiguration.allows(try cookie([.name: "other-session"])))
        XCTAssertFalse(SupportConfiguration.allows(try cookie([.domain: ".yunle.fun"])))
        XCTAssertFalse(SupportConfiguration.allows(try cookie([.path: "/tickets"])))
        XCTAssertFalse(SupportConfiguration.allows(try cookie([.secure: "FALSE"])))
    }
}
