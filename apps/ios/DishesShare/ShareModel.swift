// What the share sheet's "Dishes" does: find the link that was shared, send
// it to the server's web import (POST /api/v1/recipes/import-url, as the app's
// New Recipe → From a website), and say how it went. The recipe is saved on
// the server; the app picks it up on its next sync.
//
// It signs in with the app's own tokens, read from the Keychain group the two
// share (KeychainTokenStore.dishes) — so it works once the app has been opened
// and signed in after updating, and never shows a sign-in of its own.

import DishesCore
import Foundation
import Observation
import UniformTypeIdentifiers

@MainActor @Observable
final class ShareModel {
    enum Stage: Equatable {
        case finding
        case importing(URL)
        case done(title: String, notice: String?)
        case signedOut
        case failed(String)
    }

    private(set) var stage = Stage.finding
    private let context: NSExtensionContext?

    init(context: NSExtensionContext?) {
        self.context = context
    }

    // MARK: Server

    /// Debug builds follow the app's dev server choice (App/Developer.swift),
    /// which the app leaves in the shared Keychain group.
    private static var devServer: URL? {
        #if DEBUG
        guard let group = Bundle.main.object(forInfoDictionaryKey: "DishesKeychainGroup") as? String,
              !group.contains("$("),
              let data = try? Keychain.read(account: "DishesDevServer", accessGroup: group) else { return nil }
        return URL(string: String(decoding: data, as: UTF8.self))
        #else
        return nil
        #endif
    }

    private static var realServer: URL {
        URL(string: Bundle.main.object(forInfoDictionaryKey: "DishesAPIBase") as? String
            ?? "https://dishes.collardserver.co.uk")!
    }

    // MARK: Flow

    func start() async {
        guard stage == .finding else { return }
        guard let page = await Self.sharedLink(in: context?.inputItems as? [NSExtensionItem] ?? []) else {
            stage = .failed("There’s no web link in what was shared. Share the recipe page itself.")
            return
        }
        await run(page)
    }

    func retry() async {
        if case .importing = stage { return }
        stage = .finding
        await start()
    }

    private func run(_ page: URL) async {
        let dev = Self.devServer
        let store = KeychainTokenStore.dishes()
        // A dev server signs a token-less request in as its stand-in user.
        if dev == nil, (try? store.load()) == nil {
            stage = .signedOut
            return
        }
        stage = .importing(page)
        let auth = AuthSession(oidc: OIDCClient(config: .dishesIOS()), store: store)
        let api = APIClient(baseURL: dev ?? Self.realServer, tokens: dev == nil ? auth : nil)
        do {
            let made = try await api.recipeFromWeb(page.absoluteString)
            stage = .done(title: made.title, notice: made.notice)
        } catch APIError.signedOut {
            stage = .signedOut
        } catch APIError.http(_, _, let message) {
            stage = .failed(message)
        } catch {
            stage = .failed((error as? URLError)?.code == .timedOut
                ? "That took too long. Try again in a moment."
                : "Couldn’t reach Dishes. Check your connection and try again.")
        }
    }

    func finish() {
        context?.completeRequest(returningItems: nil)
    }

    func cancel() {
        context?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }

    // MARK: Finding the link

    /// The first http(s) link: a shared URL (Safari), else one inside shared
    /// text ("Look at this recipe https://…", as many apps share).
    static func sharedLink(in items: [NSExtensionItem]) async -> URL? {
        let providers = items.flatMap { $0.attachments ?? [] }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = await loadURL(provider), isWeb(url) { return url }
        }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = await loadText(provider), let url = firstLink(in: text) { return url }
        }
        // Some apps put the link only in the item's text.
        for item in items {
            if let text = item.attributedContentText?.string, let url = firstLink(in: text) { return url }
        }
        return nil
    }

    private static func isWeb(_ url: URL) -> Bool {
        url.scheme == "https" || url.scheme == "http"
    }

    static func firstLink(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        return detector.matches(in: text, range: range).compactMap(\.url).first(where: isWeb)
    }

    private static func loadURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
        }
    }

    private static func loadText(_ provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: String.self) { text, _ in continuation.resume(returning: text) }
        }
    }
}
