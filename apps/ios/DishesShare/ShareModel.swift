// What the share sheet's "Dishes" does:
//   - a link: the server's web import (POST /api/v1/recipes/import-url, as
//     the app's New Recipe → From a website), which reads recipe pages best
//   - a screenshot or text (a message, notes, a caption): read on the device
//     when it can (DishesCore/AI/RecipeReader, TODO_MOBILE.md D3), shown to
//     check, then saved (POST /api/v1/recipes/generated); otherwise the
//     server reads and saves it (ai/photo-recipe, ai/text-recipe)
// and says how it went. The app picks the recipe up on its next sync.
//
// It signs in with the app's own tokens, read from the Keychain group the two
// share (KeychainTokenStore.dishes) — so it works once the app has been opened
// and signed in after updating, and never shows a sign-in of its own.

import DishesCore
import Foundation
import Observation
import UIKit
import UniformTypeIdentifiers

@MainActor @Observable
final class ShareModel {
    enum Stage: Equatable {
        case finding
        case importing(URL)
        /// Reading a screenshot or text, on the device or the server.
        case reading(onDevice: Bool)
        /// Read on the device: shown before it's saved.
        case preview(GeneratedRecipe)
        case saving
        case done(title: String, notice: String?)
        case signedOut
        case failed(String)
    }

    /// What was shared, once found.
    private enum Shared {
        case link(URL)
        case images([UIImage])
        case text(String)

        var isText: Bool { if case .text = self { true } else { false } }
    }

    private(set) var stage = Stage.finding
    private let context: NSExtensionContext?

    init(context: NSExtensionContext?) {
        self.context = context
    }

    // MARK: Flow

    func start() async {
        guard stage == .finding else { return }
        switch await Self.shared(in: context?.inputItems as? [NSExtensionItem] ?? []) {
        case .link(let page)?: await run(page)
        case .images(let images)?: await read(.images(images))
        case .text(let text)?: await read(.text(text))
        case nil: stage = .failed("There’s no recipe in what was shared. Share a recipe page, a screenshot or its text.")
        }
    }

    /// The API, signed in with the app's tokens — nil (and "Sign in first") when there are none.
    private func makeAPI() -> APIClient? {
        guard let api = ExtensionAPI.client() else {
            stage = .signedOut
            return nil
        }
        return api
    }

    /// The router's two outcomes: a draft to check, or a recipe the server already saved.
    private enum Read: Sendable {
        case draft(RecipeReader.Reading)
        case saved(APIClient.CreatedRecipe)
    }

    private func read(_ shared: Shared) async {
        guard let api = makeAPI() else { return }
        stage = .reading(onDevice: DeviceAI.isAvailable)
        let context = AIContext.cached
        let metric = (context?.measurementSystem ?? "metric") == "metric"
        do {
            let run = try await AIRouter.run(
                shared.isText ? .readText : .scanRecipe,
                onDevice: {
                    guard #available(iOS 27, *) else { throw CancellationError() }
                    switch shared {
                    case .text(let text): return Read.draft(try await RecipeReader.read(text: text, context: context))
                    case .images(let images):
                        let pages = images.compactMap { $0.cgImage }
                        return Read.draft(try await RecipeReader.read(pages, context: context))
                    case .link: throw CancellationError()
                    }
                },
                check: {
                    guard case .draft(let reading) = $0 else { return [] }
                    return RecipeChecks.problems(reading.recipe, metric: metric, pageText: reading.pageText)
                },
                fallback: {
                    stage = .reading(onDevice: false)
                    switch shared {
                    case .text(let text): return Read.saved(try await api.recipeFromText(text))
                    case .images(let images):
                        guard let jpeg = images.first?.jpegData(compressionQuality: 0.8) else { throw CancellationError() }
                        return Read.saved(try await api.recipeFromPhoto(jpeg))
                    case .link: throw CancellationError()
                    }
                })
            switch run.value {
            case .draft(let reading): stage = .preview(reading.recipe)
            case .saved(let made): stage = .done(title: made.title, notice: nil)
            }
        } catch {
            fail(error)
        }
    }

    /// Save the draft shown, filed in a collection on the device when it can.
    func save(_ recipe: GeneratedRecipe) async {
        guard let api = makeAPI() else { return }
        stage = .saving
        var recipe = recipe
        // Filed on the device (nil: none fits); if it can't, the server chooses.
        if #available(iOS 27, *), DeviceAI.isAvailable, let collections = AIContext.cached?.collections, !collections.isEmpty {
            do { recipe.collectionId = .some(try await CollectionPicker.pick(for: recipe, from: collections)?.id) } catch {}
        }
        do {
            let made = try await api.saveGeneratedRecipe(recipe)
            stage = .done(title: made.title, notice: made.collectionName.map { "Filed in \($0)." })
        } catch {
            fail(error)
        }
    }

    private func fail(_ error: Error) {
        switch error {
        case APIError.signedOut: stage = .signedOut
        case APIError.http(_, _, let message): stage = .failed(message)
        default:
            stage = .failed((error as? URLError)?.code == .timedOut
                ? "That took too long. Try again in a moment."
                : "Couldn’t reach Dishes. Check your connection and try again.")
        }
    }

    func retry() async {
        switch stage {
        case .importing, .reading, .saving: return
        default: break
        }
        stage = .finding
        await start()
    }

    private func run(_ page: URL) async {
        // A dev server signs a token-less request in as its stand-in user.
        guard let api = makeAPI() else { return }
        stage = .importing(page)
        do {
            let made = try await api.recipeFromWeb(page.absoluteString)
            stage = .done(title: made.title, notice: made.notice)
        } catch {
            fail(error)
        }
    }

    func finish() {
        context?.completeRequest(returningItems: nil)
    }

    func cancel() {
        context?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }

    // MARK: Finding what was shared

    /// A link first (the server reads pages best), then images, then text
    /// long enough to hold a recipe.
    private static func shared(in items: [NSExtensionItem]) async -> Shared? {
        if let link = await sharedLink(in: items) { return .link(link) }
        let providers = items.flatMap { $0.attachments ?? [] }
        var images: [UIImage] = []
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            if let image = await loadImage(provider) { images.append(image) }
        }
        if !images.isEmpty { return .images(images) }
        var texts: [String] = []
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = await loadText(provider) { texts.append(text) }
        }
        texts += items.compactMap { $0.attributedContentText?.string }
        let text = texts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.count >= 40 ? .text(text) : nil
    }

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

    private static func loadImage(_ provider: NSItemProvider) async -> UIImage? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: UIImage.self) { image, _ in continuation.resume(returning: image as? UIImage) }
        }
    }

    private static func loadText(_ provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: String.self) { text, _ in continuation.resume(returning: text) }
        }
    }
}
