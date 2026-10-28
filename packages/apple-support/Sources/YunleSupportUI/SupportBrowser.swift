#if os(iOS)
import SwiftUI
import WebKit
import SafariServices

/// A complete in-app Support browser. Each presentation has an isolated, in-memory website session.
/// Hosts may supply verified Support cookies; account changes must recreate this view with `.id`.
public struct SupportBrowser: View {
    private let url: URL?
    private let title: String
    private let cookies: [HTTPCookie]
    @StateObject private var browser: SupportBrowserModel
    @State private var confirmClose = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    public init(configuration: SupportConfiguration, destination: SupportWebDestination = .feedback) {
        _browser = StateObject(wrappedValue: SupportBrowserModel(origin: configuration.supportOrigin))
        url = configuration.url(for: destination)
        title = configuration.appName + "支持中心"
        cookies = []
    }

    /// Open a previously verified Support page, such as a private ticket receipt.
    public init(url: URL, title: String = "云乐坊支持中心", cookies: [HTTPCookie] = [], origin: URL = SupportConfiguration.origin) {
        _browser = StateObject(wrappedValue: SupportBrowserModel(origin: origin))
        self.url = url
        self.title = title
        self.cookies = cookies
    }

    public var body: some View {
        NavigationStack {
            Group {
                if browser.ready { BrowserContent(browser: browser) }
                else if browser.error == nil { ProgressView("正在打开支持中心") }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if let error = browser.error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error)
                        Button("重新载入") { browser.reload() }
                    }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.background)
                } else if browser.loading { ProgressView().padding(6) }
            }
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("完成") { if browser.dirty { confirmClose = true } else { dismiss() } }
                        .accessibilityIdentifier("support.browser.close")
                }
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if browser.canGoBack {
                        Button { browser.webView.goBack() } label: { Label("返回上一页", systemImage: "chevron.backward") }
                    }
                    Button { browser.reload() } label: { Label("重新载入", systemImage: "arrow.clockwise") }
                        .disabled(browser.dirty)
                }
            }
        }
        .task { await browser.load(url, cookies: cookies) }
        .onDisappear { browser.webView.stopLoading() }
        .interactiveDismissDisabled(browser.dirty)
        .confirmationDialog("反馈还没有发送", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("继续填写", role: .cancel) {}
            Button("关闭页面", role: .destructive) { dismiss() }
        } message: { Text("草稿仅保留在当前网页会话中。关闭后可能无法找回，请先发送或复制内容。") }
        .sheet(item: $browser.externalPage) { page in SafariContent(url: page.url) }
        .onChange(of: browser.externalAction) { url in
            if let url { openURL(url); browser.externalAction = nil }
        }
    }
}

private struct ExternalPage: Identifiable { let id = UUID(); let url: URL }

@MainActor
private final class SupportBrowserModel: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler {
    let webView: WKWebView
    @Published var ready = false
    @Published var loading = false
    @Published var canGoBack = false
    @Published var dirty = false
    @Published var error: String?
    @Published var externalPage: ExternalPage?
    @Published var externalAction: URL?
    private let origin: URL
    private var initialURL: URL?
    private var historyObservation: NSKeyValueObservation?

    init(origin: URL) {
        self.origin = origin
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.applicationNameForUserAgent = "YunleFunSupport/2"
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // The proxy avoids a webView -> handler -> model -> webView retain cycle.
        configuration.userContentController.add(WeakMessageHandler(self), name: "yunleSupport")
        historyObservation = webView.observe(\.canGoBack, options: [.new]) { [weak self] view, _ in
            Task { @MainActor [weak self] in self?.canGoBack = view.canGoBack }
        }
    }

    func load(_ url: URL?, cookies: [HTTPCookie]) async {
        guard !ready else { return }
        guard let url, SupportConfiguration.allows(url, origin: origin) else {
            error = "支持中心地址无效，请检查应用配置。"; return
        }
        initialURL = url
        for cookie in cookies where SupportConfiguration.allows(cookie, origin: origin) {
            await withCheckedContinuation { continuation in
                webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { continuation.resume() }
            }
            guard !Task.isCancelled else { return }
        }
        guard !Task.isCancelled else { return }
        ready = true
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func reload() {
        if webView.url != nil { webView.reload() }
        else if let initialURL { webView.load(URLRequest(url: initialURL)) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let source = message.frameInfo.request.url,
              SupportConfiguration.allows(source, origin: origin), let body = message.body as? [String: Any] else { return }
        switch body["action"] as? String {
        case "draft": if let value = body["dirty"] as? Bool { dirty = value }
        case "openWebsite":
            guard let raw = body["url"] as? String, raw.count <= 4096,
                  let url = URL(string: raw), SupportConfiguration.allows(url, origin: origin) else { return }
            // Login starts here in a clean Safari context, including its verifier and callback.
            // Never forward a half-started OAuth URL or native credentials to another browser.
            externalPage = ExternalPage(url: url)
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if SupportConfiguration.allows(url, origin: origin) {
            if navigationAction.targetFrame == nil {
                decisionHandler(.cancel); webView.load(navigationAction.request)
            } else { decisionHandler(.allow) }
        } else {
            decisionHandler(.cancel)
            if ["https", "http"].contains(url.scheme ?? "") { externalPage = ExternalPage(url: url) }
            else if ["mailto", "weixin"].contains(url.scheme ?? "") { externalAction = url }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard !navigationResponse.isForMainFrame || navigationResponse.response.url.map({ SupportConfiguration.allows($0, origin: origin) }) == true
        else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading = true; error = nil }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false; canGoBack = webView.canGoBack }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { loading = false; error = "页面已暂停，请重新载入。" }
    private func failed(_ error: Error) {
        loading = false
        if (error as? URLError)?.code != .cancelled { self.error = "页面暂时无法打开，请检查网络后重试。" }
    }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

private struct BrowserContent: UIViewRepresentable {
    let browser: SupportBrowserModel
    func makeUIView(context: Context) -> WKWebView { browser.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
private struct SafariContent: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
#endif
