import XCTest
import WebKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// Uses the native WebKit engine with mocked extension messaging. Safari's permission UI
// and full extension lifecycle still need separate device/Safari validation.
@MainActor
final class SafariEngineTests: XCTestCase, WKScriptMessageHandler {
    private var webView: WKWebView?
    private var messages: [[String: Any]] = []
    private let isolated = WKContentWorld.world(name: "InputDefenderTests")

    private var extensionURL: URL {
        Bundle.main.builtInPlugInsURL!.appendingPathComponent("Input Defender Extension.appex", isDirectory: true)
    }
    private var resources: URL { Bundle(url: extensionURL)!.resourceURL! }
    private func source(_ file: String) throws -> String {
        try String(contentsOf: resources.appendingPathComponent(file), encoding: .utf8)
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let metadata = message.body as? [String: Any] { messages.append(metadata) }
    }
    override func tearDown() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "audit", contentWorld: isolated)
        webView?.removeFromSuperview()
        webView = nil
        messages = []
        super.tearDown()
    }
    private func prepare(mode: String = "observe") throws {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let content = config.userContentController
        content.add(self, contentWorld: isolated, name: "audit")
        let messaging = """
        globalThis.chrome = {runtime: {
          sendMessage: async message => {
            window.webkit.messageHandlers.audit.postMessage(message);
            return message.type === 'config' ? {settings:{mode:'\(mode)',allowlist:[]}} : {ok:true};
          },
          onMessage: {addListener: callback => { globalThis.receiveFromWorker = callback; }}
        }};
        """
        content.addUserScript(WKUserScript(source: messaging, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: isolated))
        content.addUserScript(WKUserScript(source: try source("main-world.js"), injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page))
        content.addUserScript(WKUserScript(source: try source("isolated-world.js"), injectionTime: .atDocumentStart, forMainFrameOnly: false, in: isolated))
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        webView = view
        #if os(macOS)
        NSApplication.shared.windows.first(where: { $0.contentView != nil })?.contentView?.addSubview(view)
        #else
        let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow)
        window?.rootViewController?.view.addSubview(view)
        #endif
        view.load(URLRequest(url: URL(string: "http://127.0.0.1:4173/structure-lab.html")!))
    }
    private func waitFor(_ predicate: () -> Bool) async throws {
        for _ in 0..<150 {
            if predicate() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("Expected sanitized metadata was not observed in WebKit")
    }
    private func hasReason(_ reason: String, blocked: Bool? = nil) -> Bool {
        messages.contains { message in
            guard let incident = message["incident"] as? [String: Any],
                  let reasons = incident["reasons"] as? [String], reasons.contains(reason) else { return false }
            return blocked == nil || incident["blocked"] as? Bool == blocked
        }
    }
    func testSafariManifestParsesWithoutErrors() async throws {
        let bundle = try XCTUnwrap(Bundle(url: extensionURL))
        let ext = try await WKWebExtension(appExtensionBundle: bundle)
        XCTAssertEqual(ext.manifestVersion, 3)
        XCTAssertEqual(ext.manifest["permissions"] as? [String], ["storage"])
        XCTAssertTrue(ext.hasInjectedContent)
        XCTAssertTrue(ext.errors.isEmpty, "\(ext.errors)")
    }
    func testEmptyFormAndStructuralChangesWithoutReadingValues() async throws {
        try prepare()
        try await waitFor { self.hasReason("form-query") }
        try await waitFor { self.messages.contains { ($0["structure"] as? [String: Any])?["complete"] as? Bool == true } }
        _ = try await webView!.evaluateJavaScript("""
        Object.defineProperty(HTMLInputElement.prototype, 'value', {get(){throw new Error('Value read');}});
        document.getElementById('query-form').setAttribute('action','http://127.0.0.1:4174/PRIVATE?name=PRIVATE');
        document.getElementById('add-script').click();
        document.getElementById('add-frame').click(); true;
        """)
        try await waitFor { self.hasReason("form-changed") && self.hasReason("script-origin-added") && self.hasReason("frame-origin-added") }
        let encoded = try JSONSerialization.data(withJSONObject: messages)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("PRIVATE"))
    }
    func testStrictModeStopsNativeFormSubmission() async throws {
        try prepare(mode: "block")
        try await waitFor { self.hasReason("form-query") }
        try await waitFor { self.messages.contains { $0["type"] as? String == "hooks-ready" } }
        let result = try await webView!.evaluateJavaScript("""
        (()=>{try{document.getElementById('query-form').submit();return 'sent';}catch(error){return error.name;}})();
        """) as? String
        XCTAssertEqual(result, "SecurityError")
        try await waitFor { self.hasReason("form-query", blocked: true) }
    }
    #if os(macOS)
    func testMacSetupWindowLayout() throws {
        let window = try XCTUnwrap(NSApplication.shared.windows.first(where: { $0.contentView != nil }))
        let view = try XCTUnwrap(window.contentView)
        view.layoutSubtreeIfNeeded()
        XCTAssertGreaterThanOrEqual(view.bounds.width, 640)
        XCTAssertGreaterThanOrEqual(view.bounds.height, 580)
        let bitmap = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = "macos-onboarding"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    #endif
}
