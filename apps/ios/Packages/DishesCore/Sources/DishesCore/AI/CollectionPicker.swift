// Which of the household's collections a new recipe belongs in, on the
// device (TODO_MOBILE.md, D3) — the twin of the server's
// `collectionSuggestionFor` (apps/web/app/actions/ai.ts), from the cached
// collection names (AIContext). The answer can only be one of them or none:
// a dynamic schema lists them, so nothing is invented.
//
//   let filed = try await CollectionPicker.pick(for: recipe, from: AIContext.cached?.collections ?? [])

import Foundation
import FoundationModels

public enum CollectionPicker {
    static let none = "None of them"

    /// The collection, or nil when none clearly fits (or there are none).
    @available(iOS 27, macOS 27, *)
    public static func pick(for recipe: GeneratedRecipe, from collections: [AIContext.Collection]) async throws -> AIContext.Collection? {
        let names = Array(Set(collections.map(\.name))).sorted()
        guard !names.isEmpty, !recipe.title.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let schema = try GenerationSchema(root: DynamicGenerationSchema(
            name: "Filing",
            properties: [.init(name: "collection", description: "The collection's exact name, or “\(none)”",
                               schema: DynamicGenerationSchema(name: "Collection", anyOf: names + [none]))]),
            dependencies: [])
        let session = LanguageModelSession(instructions: Prompts.fileRecipe)
        let answer = try await session.respond(to: Prompts.fileRecipeQuestion(recipe, collections: collections), schema: schema)
        let picked = try answer.content.value(String.self, forProperty: "collection")
        return collections.first { $0.name == picked }
    }
}
