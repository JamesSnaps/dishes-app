// Recipes in Spotlight's semantic index (TODO_MOBILE.md, Phase D1): "find
// that chicken thing we had last week" from the Home Screen or Siri, with a
// tap straight to the recipe (OpenRecipeIntent).
//
// It follows the database rather than hooking into sync, so a recipe edited
// here, synced down or deleted on another device is caught the same way.
// What's in the index is remembered in the store's meta table (a fingerprint
// per id), so only changes are sent and a recipe deleted while the app was
// closed is still taken out. Signing out wipes the store, which empties it.
//
//   Task { await SpotlightIndex.shared.follow(store) }   // AppModel.launch

import AppIntents
import CoreSpotlight
import CryptoKit
import DishesCore
import Foundation
import os

@MainActor
final class SpotlightIndex {
    static let shared = SpotlightIndex()

    /// The app's own index. Made where it's used: CSSearchableIndex isn't
    /// Sendable, and every handle with this name is the same index.
    nonisolated private static func index() -> CSSearchableIndex { CSSearchableIndex(name: "dishes") }
    nonisolated private static let metaKey = "spotlight"
    private let log = Logger(subsystem: "uk.collco.dishes", category: "spotlight")
    private var following = false
    /// What Spotlight has, as last saved.
    private var indexed = Indexed()

    /// What's indexed, by entity id: a digest of what was sent.
    private struct Indexed: Codable, Equatable {
        var recipes: [String: String] = [:]
    }

    private struct Snapshot: Sendable {
        var recipes: [(Recipe, Date?)]
    }

    func follow(_ store: LocalStore) async {
        guard !following else { return }
        following = true
        let base = AppModel.serverURL
        let saved = try? await store.read { try $0.meta(Self.metaKey) }
        if let saved = saved.flatMap({ $0 }), let decoded = try? JSONDecoder().decode(Indexed.self, from: Data(saved.utf8)) {
            indexed = decoded
        } else {
            // No record of what's there (first run, or the store was wiped switching server): start clean.
            try? await Self.clear()
        }
        log.info("following the store; \(self.indexed.recipes.count) recipes indexed before")
        do {
            for try await snapshot in store.observe({ r in
                Snapshot(recipes: try IntentData.load(r))
            }) {
                await update(snapshot, base: base, store: store)
            }
        } catch {
            log.error("stopped following the store: \(error)")
            following = false
        }
    }

    private func update(_ snapshot: Snapshot, base: URL, store: LocalStore) async {
        let before = indexed
        let recipes = snapshot.recipes.map { recipe, cooked in
            RecipeEntity(recipe, lastCooked: cooked, thumbnail: IntentData.imageURL(recipe.thumbnailUrl ?? recipe.imageUrl, base: base))
        }
        var after = Indexed()
        for recipe in recipes { after.recipes[recipe.id] = Self.fingerprint(recipe) }
        guard after != before else { return }

        do {
            try await Self.send(recipes.filter { before.recipes[$0.id] != after.recipes[$0.id] },
                                removing: before.recipes.keys.filter { after.recipes[$0] == nil })
        } catch {
            // Spotlight said no (indexing off, or the device is busy): the next change tries again from the same baseline.
            log.error("indexing failed: \(error)")
            return
        }
        log.info("indexed \(after.recipes.count) recipes")
        indexed = after
        // A suspended store refuses this; the next launch then re-sends the same changes, which is harmless.
        let json = String(decoding: (try? JSONEncoder().encode(after)) ?? Data(), as: UTF8.self)
        try? await store.write { try $0.setMeta(Self.metaKey, json) }
    }

    nonisolated private static func send(_ changed: [RecipeEntity], removing gone: [String]) async throws {
        let index = index()
        if !changed.isEmpty { try await index.indexAppEntities(changed) }
        if !gone.isEmpty { try await index.deleteAppEntities(identifiedBy: gone, ofType: RecipeEntity.self) }
    }

    nonisolated private static func clear() async throws {
        try await index().deleteAppEntities(ofType: RecipeEntity.self)
    }

    /// Whatever Spotlight shows or searches on, so an unrelated change to the
    /// row sends nothing. SHA-256 rather than Hasher, which is seeded afresh
    /// at every launch.
    private static func fingerprint(_ recipe: RecipeEntity) -> String {
        digest([recipe.title, recipe.cuisine ?? "", recipe.tags.joined(separator: ","), recipe.ingredients.joined(separator: ","),
                recipe.totalMinutes.map(String.init) ?? "", recipe.isFavourite ? "fav" : "",
                recipe.lastCooked.map { String($0.timeIntervalSince1970) } ?? "", recipe.description ?? "",
                recipe.thumbnail?.absoluteString ?? ""])
    }

    private static func digest(_ parts: [String]) -> String {
        SHA256.hash(data: Data(parts.joined(separator: "\u{1F}").utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }
}
