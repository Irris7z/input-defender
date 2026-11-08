import SafariServices

// No native-messaging permission is requested. Never inspect, echo, or log a payload.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.cancelRequest(withError: NSError(
            domain: "InputDefender.NativeMessaging", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Native messaging is disabled."]
        ))
    }
}
