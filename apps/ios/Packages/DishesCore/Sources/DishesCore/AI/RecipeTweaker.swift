// "Improve with AI" on the device (TODO_MOBILE.md, D3; the server's version is
// `improveRecipe`, the ai.improve / ai.refine actions).
//
// The server's model writes the whole recipe back out. The on-device one
// writes only the edits — change "500g beef mince", remove step 2, add an
// ingredient — picked from the recipe's own lines, and the code applies them, so what wasn't asked about is
// kept exactly (the server prompt's "preserve everything else", by
// construction) and the answer is short enough for a 4,096-token context.
// Nutrition isn't estimated here: when the ingredients or servings change
// (`nutritionStale`) the tweak goes to the server without it, and the server
// estimates it once the tweak is saved.
//
//   let tweak = try await RecipeTweaker.improve(recipe, instruction: "Make it vegetarian", context: AIContext.cached)
//   TweakChecks.problems(tweak, original: recipe, metric: true)

import Foundation
import FoundationModels

public enum RecipeTweaker {
    /// The changed recipe, its one-line summary and the edits it came from.
    public struct Tweak: Sendable {
        public var recipe: GeneratedRecipe
        public var summary: String
        /// Edits that pointed at an ingredient or step that isn't there.
        public var misplaced: [String]
        public var changed: Bool
        /// The ingredients or servings changed, so the recipe's nutrition no longer holds.
        public var nutritionStale: Bool
    }

    @available(iOS 27, macOS 27, *)
    public static func improve(_ recipe: GeneratedRecipe, instruction: String, context: AIContext?) async throws -> Tweak {
        let lines = Prompts.ingredientLines(recipe)
        let steps = recipe.steps.indices.map { "Step \($0 + 1)" }
        let session = LanguageModelSession(instructions: Prompts.improveRecipe(context))
        let answer = try await session.respond(to: Prompts.improveRecipeRequest(recipe, instruction: instruction),
                                               schema: try editsSchema(ingredients: lines, steps: steps))
        return apply(try edits(from: answer.content, ingredients: lines, steps: steps), to: recipe)
    }

    /// The edits' shape, made for this recipe: an ingredient or step is picked
    /// from the recipe's own (its line, "Step 2"), so an edit can't point at
    /// one that isn't there. Numbered, the model pointed at "ingredient 10" of
    /// eight in a third of the evaluation's tweaks.
    @available(iOS 27, macOS 27, *)
    static func editsSchema(ingredients: [String], steps: [String]) throws -> GenerationSchema {
        let text = DynamicGenerationSchema(type: String.self)
        func one(_ name: String, _ choices: [String]) -> DynamicGenerationSchema {
            choices.isEmpty ? text : DynamicGenerationSchema(name: name, anyOf: choices)
        }
        func list(_ item: DynamicGenerationSchema) -> DynamicGenerationSchema { DynamicGenerationSchema(arrayOf: item) }
        func object(_ name: String, _ properties: [DynamicGenerationSchema.Property]) -> DynamicGenerationSchema {
            DynamicGenerationSchema(name: name, properties: properties)
        }
        let quantity = DynamicGenerationSchema.Property(name: "quantity", description: "The amount and measure, e.g. \"250g\", \"2 tbsp\" or \"4\"; empty if none", schema: text)
        let name = DynamicGenerationSchema.Property(name: "name", description: "The ingredient's name", schema: text)
        let prep = DynamicGenerationSchema.Property(name: "preparation", description: "Preparation such as \"finely chopped\"; empty if none", schema: text)
        return try GenerationSchema(root: object("Edits", [
            .init(name: "summary", description: "One sentence in the first person, e.g. \"I've swapped the beef for lentils…\": what you changed and why", schema: text),
            .init(name: "title", description: "A new title, only when the change makes the old one wrong; empty to keep it", schema: text),
            .init(name: "servings", description: "A new number of servings, only when the request changes it; empty to keep it", schema: text),
            .init(name: "removeIngredients", description: "Ingredients to take out", schema: list(one("Ingredient", ingredients))),
            .init(name: "changeIngredients", description: "Ingredients to replace or alter, each with its new quantity, name and preparation",
                  schema: list(object("IngredientChange", [.init(name: "ingredient", schema: one("Ingredient", ingredients)), quantity, name, prep]))),
            .init(name: "addIngredients", description: "New ingredients", schema: list(object("NewIngredient", [quantity, name, prep]))),
            .init(name: "removeSteps", description: "Steps to take out", schema: list(one("Step", steps))),
            .init(name: "changeSteps", description: "Steps to rewrite, including any that mention an ingredient you've removed or replaced",
                  schema: list(object("StepChange", [.init(name: "step", schema: one("Step", steps)),
                                                     .init(name: "instruction", description: "The step's whole new instruction", schema: text)]))),
            .init(name: "addSteps", description: "New steps",
                  schema: list(object("NewStep", [.init(name: "after", schema: one("Place", ["At the start"] + steps.map { "After \($0.lowercased())" })),
                                                  .init(name: "instruction", schema: text)]))),
        ]), dependencies: [])
    }

    @available(iOS 27, macOS 27, *)
    static func edits(from content: GeneratedContent, ingredients: [String], steps: [String]) throws -> Edits {
        let string = { (c: GeneratedContent, key: String) in (try? c.value(String.self, forProperty: key)) ?? "" }
        let items = { (key: String) in (try? content.value([GeneratedContent].self, forProperty: key)) ?? [] }
        let ingredient = { (label: String) in (ingredients.firstIndex(of: label) ?? -1) + 1 }
        let step = { (label: String) in (steps.firstIndex(of: label) ?? -1) + 1 }
        var out = Edits(summary: string(content, "summary"), title: string(content, "title"), servings: string(content, "servings"))
        out.ingredients += items("removeIngredients").map { .init(.remove, ingredient((try? $0.value(String.self)) ?? "")) }
        out.ingredients += items("changeIngredients").map {
            .init(.change, ingredient(string($0, "ingredient")), quantity: string($0, "quantity"), name: string($0, "name"), preparation: string($0, "preparation"))
        }
        out.ingredients += items("addIngredients").map {
            .init(.add, ingredients.count, quantity: string($0, "quantity"), name: string($0, "name"), preparation: string($0, "preparation"))
        }
        out.steps += items("removeSteps").map { .init(.remove, step((try? $0.value(String.self)) ?? "")) }
        out.steps += items("changeSteps").map { .init(.change, step(string($0, "step")), instruction: string($0, "instruction")) }
        out.steps += items("addSteps").map { e in
            let after = string(e, "after")
            return .init(.add, after == "At the start" ? 0 : (steps.firstIndex { "After \($0.lowercased())" == after } ?? steps.count - 1) + 1,
                         instruction: string(e, "instruction"))
        }
        return out
    }

    /// The edits as plain values, so applying them needs no model (and is tested without one).
    public struct Edits: Sendable {
        public enum Action: String, Sendable { case change, remove, add }
        public struct Ingredient: Sendable {
            public var action: Action; public var number: Int; public var quantity: String; public var name: String; public var preparation: String
            public init(_ action: Action, _ number: Int, quantity: String = "", name: String = "", preparation: String = "") {
                self.action = action; self.number = number; self.quantity = quantity; self.name = name; self.preparation = preparation
            }
        }
        public struct Step: Sendable {
            public var action: Action; public var number: Int; public var instruction: String
            public init(_ action: Action, _ number: Int, instruction: String = "") {
                self.action = action; self.number = number; self.instruction = instruction
            }
        }
        public var summary: String
        public var title: String = ""
        public var servings: String = ""
        public var ingredients: [Ingredient] = []
        public var steps: [Step] = []
        public init(summary: String, title: String = "", servings: String = "", ingredients: [Ingredient] = [], steps: [Step] = []) {
            self.summary = summary; self.title = title; self.servings = servings; self.ingredients = ingredients; self.steps = steps
        }
    }

    /// Numbers are the original recipe's, 1 for the first; an add goes after
    /// its number (0: at the top). Edits to the same item: the last one wins.
    public static func apply(_ edits: Edits, to recipe: GeneratedRecipe) -> Tweak {
        let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        var misplaced: [String] = []
        var out = recipe

        // Ingredients: each original slot kept, replaced or dropped, adds after it.
        var slots: [GeneratedRecipe.Ingredient?] = recipe.ingredients.map { $0 }
        var adds: [Int: [GeneratedRecipe.Ingredient]] = [:]
        for e in edits.ingredients {
            let (amount, unit) = IngredientRules.splitQuantity(trim(e.quantity))
            switch e.action {
            case .add:
                guard (0...recipe.ingredients.count).contains(e.number) else { misplaced.append("an ingredient after \(e.number)"); continue }
                let group = e.number > 0 ? recipe.ingredients[e.number - 1].groupLabel : ""
                adds[e.number, default: []].append(.init(ingredientName: trim(e.name), amount: amount, unit: unit,
                                                         preparation: trim(e.preparation), groupLabel: group))
            case .change, .remove:
                guard recipe.ingredients.indices.contains(e.number - 1) else { misplaced.append("ingredient \(e.number)"); continue }
                if e.action == .remove { slots[e.number - 1] = nil; continue }
                var i = recipe.ingredients[e.number - 1]
                i.ingredientName = trim(e.name).isEmpty ? i.ingredientName : trim(e.name)
                (i.amount, i.unit, i.preparation) = (amount, unit, trim(e.preparation))
                slots[e.number - 1] = i
            }
        }
        out.ingredients = (adds[0] ?? []) + slots.enumerated().flatMap { n, slot in [slot].compactMap { $0 } + (adds[n + 1] ?? []) }

        // Steps the same way; a changed step keeps its timer.
        var steps: [GeneratedRecipe.Step?] = recipe.steps.map { $0 }
        var stepAdds: [Int: [GeneratedRecipe.Step]] = [:]
        for e in edits.steps {
            switch e.action {
            case .add:
                guard (0...recipe.steps.count).contains(e.number) else { misplaced.append("a step after \(e.number)"); continue }
                let group = e.number > 0 ? recipe.steps[e.number - 1].groupLabel : ""
                stepAdds[e.number, default: []].append(.init(instruction: trim(e.instruction), groupLabel: group))
            case .change, .remove:
                guard recipe.steps.indices.contains(e.number - 1) else { misplaced.append("step \(e.number)"); continue }
                if e.action == .remove { steps[e.number - 1] = nil; continue }
                steps[e.number - 1]?.instruction = trim(e.instruction)
            }
        }
        out.steps = (stepAdds[0] ?? []) + steps.enumerated().flatMap { n, s in [s].compactMap { $0 } + (stepAdds[n + 1] ?? []) }

        if !trim(edits.title).isEmpty { out.title = trim(edits.title) }
        if !trim(edits.servings).isEmpty { out.servings = trim(edits.servings) }
        return Tweak(recipe: out, summary: trim(edits.summary), misplaced: misplaced, changed: out != recipe,
                     nutritionStale: out.ingredients != recipe.ingredients || out.servings != recipe.servings)
    }
}

/// What a tweak from the device must get right before it's shown.
public enum TweakChecks {
    public static func problems(_ tweak: RecipeTweaker.Tweak, original: GeneratedRecipe, metric: Bool) -> [String] {
        var out = RecipeChecks.problems(tweak.recipe, metric: metric)
        if !tweak.changed { out.append("nothing changed") }
        if tweak.summary.isEmpty { out.append("no summary") }
        if !tweak.misplaced.isEmpty { out.append("edits to " + tweak.misplaced.joined(separator: ", ") + ", which aren’t there") }
        // Most of the recipe gone is a rewrite, not a tweak: "add a red pepper"
        // once came back as the pepper alone.
        let kept = original.ingredients.filter { i in tweak.recipe.ingredients.contains { $0.ingredientName == i.ingredientName } }.count
        if kept * 2 < original.ingredients.count { out.append("only \(kept) of \(original.ingredients.count) ingredients kept") }
        // A step still using an ingredient that's gone: the carbonara kept
        // "crisp the guanciale" after the guanciale became bacon.
        let gone = original.ingredients.map(\.ingredientName).filter { name in !tweak.recipe.ingredients.contains { $0.ingredientName == name } }
        for name in gone {
            let word = name.lowercased().split(separator: " ").last.map(String.init) ?? ""
            guard word.count > 3, !tweak.recipe.ingredients.contains(where: { $0.ingredientName.lowercased().contains(word) }) else { continue }
            let stem = word.hasSuffix("s") ? String(word.dropLast()) : word
            if let step = tweak.recipe.steps.first(where: { $0.instruction.lowercased().contains(stem) }) {
                out.append("“\(step.instruction.prefix(40))…” still uses \(name)")
                break
            }
        }
        // The server's prompt forbids it: make the change, don't write around it.
        let workaround = /\b(skip|omit|ignore|leave out|don't add|do not add)\b/
        let before = original.steps.filter { $0.instruction.lowercased().contains(workaround) }.count
        if tweak.recipe.steps.filter({ $0.instruction.lowercased().contains(workaround) }).count > before {
            out.append("a step works around an ingredient instead of changing it")
        }
        return out
    }
}
