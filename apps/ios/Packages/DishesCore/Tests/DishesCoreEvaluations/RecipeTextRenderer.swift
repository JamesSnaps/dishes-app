// Writes a recipe out the way people share one as text, so the text
// evaluation has samples with known answers: a blog post with a chatty
// intro, a message to a friend, an Instagram caption, terse notes.

import Foundation
@testable import DishesCore

enum TextStyle: String, CaseIterable {
    case blog, message, caption, notes
}

enum RecipeTextRenderer {
    static func render(_ recipe: GeneratedRecipe, style: TextStyle) -> String {
        let lines = recipe.ingredients.map(RecipeCardRenderer.line)
        let steps = recipe.steps.map(\.instruction)
        let time = [recipe.prepTimeMinutes.map { "prep \($0) min" }, recipe.cookTimeMinutes.map { "cook \($0) min" }]
            .compactMap { $0 }.joined(separator: ", ")
        switch style {
        case .blog:
            return """
                \(recipe.title)

                I've been making this for years and honestly it never gets old. My kids ask for it every week, \
                and it's one of those recipes that just works. Scroll down for the recipe — but first, a few tips. \
                Don't rush it, use good ingredients, and taste as you go!

                \(recipe.description)

                Serves \(recipe.servings)\(time.isEmpty ? "" : " | \(time)")

                INGREDIENTS
                \(lines.map { "• \($0)" }.joined(separator: "\n"))

                METHOD
                \(steps.enumerated().map { "Step \($0.offset + 1): \($0.element)" }.joined(separator: "\n"))

                If you make this, let me know in the comments! Pin it for later. 💛
                """
        case .message:
            return """
                Here's that \(recipe.title.lowercased()) recipe you asked for! Serves \(recipe.servings). You'll need \
                \(lines.dropLast().joined(separator: ", ")) and \(lines.last ?? "").
                \(steps.joined(separator: " Then "))
                Let me know how it goes x
                """
        case .caption:
            return """
                ✨ \(recipe.title.uppercased()) ✨
                \(recipe.description) 😍
                🛒 You'll need:
                \(lines.map { "▪️ \($0)" }.joined(separator: "\n"))
                👩‍🍳 How to:
                \(steps.enumerated().map { "\($0.offset + 1)️⃣ \($0.element)" }.joined(separator: "\n"))
                Save this for later! 📌
                #recipe #homecooking #\(recipe.cuisine.lowercased().replacingOccurrences(of: " ", with: "")) #dinnerideas #foodie
                """
        case .notes:
            return """
                \(recipe.title) - serves \(recipe.servings)
                \(lines.joined(separator: "\n"))
                --
                \(steps.map { "- \($0)" }.joined(separator: "\n"))
                """
        }
    }
}
