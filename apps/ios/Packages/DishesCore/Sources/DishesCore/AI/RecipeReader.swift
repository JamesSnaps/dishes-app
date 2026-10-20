// A photo of a cookbook page or recipe card → a recipe to review, on the
// device (TODO_MOBILE.md, Phase D2/D3; the server's version is
// `analyzeRecipePhoto`, POST /api/v1/ai/photo-recipe).
//
// Vision reads the text first (every page of a two-page recipe, in order);
// the on-device model then sorts it into the recipe's fields by guided
// generation. The photo goes in as well when there's little text — a
// handwritten card Vision can't read well — and stays out otherwise: the
// on-device model's context is small (4,096 tokens on AFM 3 Core), and the
// text is what it needs.
//
// Not Vision's OCRTool: that lets the model decide to read the page, one more
// round trip for a small model to get wrong, and it isn't in the simulator.
//
//   let reading = try await RecipeReader.read(pages, context: AIContext.cached)
//   RecipeChecks.problems(reading.recipe, metric: true, pageText: reading.pageText)

import CoreGraphics
import Foundation
import FoundationModels
import Vision

public enum RecipeReader {
    /// Below this much recognised text the photo itself goes to the model too.
    static let littleText = 300

    /// Every page's text, in reading order, a blank line between pages.
    public static func text(of pages: [CGImage]) async throws -> String {
        var out: [String] = []
        for page in pages {
            var request = RecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let lines = try await request.perform(on: page).compactMap { $0.topCandidates(1).first?.string }
            out.append(lines.joined(separator: "\n"))
        }
        return out.joined(separator: "\n\n")
    }

    /// The recipe and the text it was read from (for RecipeChecks' `pageText`).
    public struct Reading: Sendable {
        public var recipe: GeneratedRecipe
        public var pageText: String
    }

    /// A recipe from text — shared from a message, notes or a caption.
    @available(iOS 27, macOS 27, *)
    public static func read(text: String, context: AIContext?) async throws -> Reading {
        let session = LanguageModelSession(instructions: Prompts.readRecipe(context, from: .text))
        let draft = try await session.respond(generating: RecipeDraft.self) {
            "The text:\n\(text)"
            "Extract the complete recipe."
        }.content
        return Reading(recipe: recoverNames(draft.recipe, from: text), pageText: text)
    }

    @available(iOS 27, macOS 27, *)
    public static func read(_ pages: [CGImage], context: AIContext?) async throws -> Reading {
        let text = try await text(of: pages)
        let withImages = text.count < littleText
        let session = LanguageModelSession(instructions: Prompts.readRecipe(context))
        let draft = try await session.respond(generating: RecipeDraft.self) {
            "Text recognised on the page:\n\(text.isEmpty ? "(none)" : text)"
            if withImages {
                for page in pages { Attachment(page) }
            }
            "Extract the complete recipe."
        }.content
        return Reading(recipe: recoverNames(draft.recipe, from: text), pageText: text)
    }

    /// The small model sometimes keeps a line's preparation and drops its name
    /// — "salt, to taste" comes back as [] [to taste] — whatever the prompt
    /// says. The printed line is on the page: read the name from it with the
    /// ingredient rules, so it's the page's word, not a guess.
    static func recoverNames(_ recipe: GeneratedRecipe, from text: String) -> GeneratedRecipe {
        var out = recipe
        var lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        for n in out.ingredients.indices where out.ingredients[n].ingredientName.isEmpty {
            let prep = out.ingredients[n].preparation.lowercased()
            guard !prep.isEmpty,
                  let at = lines.firstIndex(where: { $0.lowercased().hasSuffix(", " + prep) }),
                  let parsed = IngredientRules.parse(lines[at]), !parsed.ingredientName.isEmpty else { continue }
            out.ingredients[n].ingredientName = parsed.ingredientName
            lines.remove(at: at)
        }
        return out
    }
}

// MARK: What the model writes

/// The recipe as the on-device model fills it in: `GeneratedRecipe` without
/// what's better left to the server (nutrition, meal role, the collection).
@available(iOS 27, macOS 27, *)
@Generable(description: "A recipe read from a cookbook page or recipe card")
struct RecipeDraft {
    @Guide(description: "The recipe's title as printed, or the dish's plain name when none is given")
    var title: String
    @Guide(description: "One or two sentences on the dish, from the page; empty if there's none")
    var description: String
    @Guide(description: "The cuisine, e.g. \"Italian\" or \"British\"")
    var cuisine: String
    @Guide(.anyOf(["easy", "medium", "hard"]))
    var difficulty: String
    @Guide(description: "Preparation time in minutes, if the page gives it")
    var prepTimeMinutes: Int?
    @Guide(description: "Cooking time in minutes, if the page gives it")
    var cookTimeMinutes: Int?
    @Guide(description: "How many it serves, as a number, e.g. \"4\"")
    var servings: String
    @Guide(description: "Which meals the dish suits", .maximumCount(3))
    var mealTypes: [MealType]
    @Guide(description: "Every ingredient, in the order printed")
    var ingredients: [DraftIngredient]
    @Guide(description: "Every step of the method, in order")
    var steps: [DraftStep]
    @Guide(description: "Tips, storage or variations printed on the page; empty if none")
    var notes: String

    var recipe: GeneratedRecipe {
        let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        return GeneratedRecipe(
            title: trim(title), description: trim(description), cuisine: trim(cuisine),
            difficulty: RecipeChecks.difficulties.contains(difficulty) ? difficulty : "medium",
            prepTimeMinutes: prepTimeMinutes.flatMap { $0 > 0 ? $0 : nil },
            cookTimeMinutes: cookTimeMinutes.flatMap { $0 > 0 ? $0 : nil },
            servings: trim(servings).isEmpty ? "4" : trim(servings),
            mealTypes: Array(Set(mealTypes.map(\.rawValue))).sorted(),
            // Likewise a blank ingredient row; one with a quantity and no name stays, for RecipeChecks to refuse.
            ingredients: ingredients.filter { !(trim($0.name) + trim($0.quantity) + trim($0.preparation)).isEmpty }.map {
                let (amount, unit) = IngredientRules.splitQuantity($0.quantity)
                return GeneratedRecipe.Ingredient(ingredientName: trim($0.name), amount: amount, unit: unit,
                                                  preparation: trim($0.preparation), isOptional: $0.optional, groupLabel: trim($0.section))
            },
            // An empty step says nothing; the small model sometimes leaves one at a column break.
            steps: steps.filter { !trim($0.instruction).isEmpty }.map {
                GeneratedRecipe.Step(instruction: trim($0.instruction),
                                     durationMinutes: $0.minutes.flatMap { $0 > 0 ? String($0) : nil } ?? "",
                                     timerLabel: $0.minutes == nil ? "" : trim($0.timerLabel), groupLabel: trim($0.section))
            },
            notes: trim(notes).isEmpty ? nil : trim(notes))
    }
}

@available(iOS 27, macOS 27, *)
@Generable
enum MealType: String {
    case breakfast, lunch, dinner, dessert, snack
}

/// The model copies the quantity as printed and the rules split it
/// (IngredientRules.splitQuantity): asked for amount and unit apart, it filled
/// the unit for things that are counted — "2 · bay leaves · bay leaves",
/// "8 ea corn tortillas" — in two cards out of three. A regex guide on the unit
/// made the whole draft worse instead.
@available(iOS 27, macOS 27, *)
@Generable
struct DraftIngredient {
    @Guide(description: "The amount and its measure exactly as printed before the ingredient, e.g. \"250g\", \"2 tbsp\", \"1-2\" or \"4\"; empty if none")
    var quantity: String
    @Guide(description: "The ingredient itself, without its quantity or preparation")
    var name: String
    @Guide(description: "Preparation such as \"finely chopped\"; empty if none")
    var preparation: String
    var optional: Bool
    @Guide(description: "The section heading it's under, e.g. \"For the sauce\"; empty if none")
    var section: String
}

@available(iOS 27, macOS 27, *)
@Generable
struct DraftStep {
    @Guide(description: "The step's instruction, as printed")
    var instruction: String
    @Guide(description: "How many minutes the step takes, only if it says")
    var minutes: Int?
    @Guide(description: "A short timer name such as \"Simmer\", when the step has minutes; empty otherwise")
    var timerLabel: String
    @Guide(description: "The method section it's under; empty if none")
    var section: String
}
