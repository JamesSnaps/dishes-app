// What an on-device answer must get right before it's used (AIRouter's
// `check`): the shape the server and the screens rely on, and nothing made
// up. A failed check sends the job to the server; it doesn't patch the answer.
// The evaluations score the same answers against expected ones on top.

import Foundation

public enum RecipeChecks {
    static let difficulties: Set<String> = ["easy", "medium", "hard"]
    static let mealTypes: Set<String> = ["breakfast", "lunch", "dinner", "dessert", "snack"]
    /// Imperial and US measures a metric household's recipe mustn't use. Spoons
    /// stay allowed: UK cookbooks measure small amounts in them.
    static let imperialUnits: Set<String> = [
        "cup", "cups", "c", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "fl oz", "fl. oz",
        "pint", "pints", "pt", "quart", "quarts", "qt", "gallon", "gallons", "gl",
    ]

    /// The page as Vision read it, ready to look things up in: Vision reads 0
    /// as "o" and 1 as "l" next to other digits ("6oml" is 60 ml), which the
    /// model rightly corrects.
    static func lookup(_ pageText: String) -> String {
        var page = IngredientRules.normaliseFractions(pageText).lowercased()
        for _ in 0..<2 {
            page = page.replacing(/([0-9])o/) { "\($0.1)0" }.replacing(/o([0-9])/) { "0\($0.1)" }
                .replacing(/([0-9])[il|]/) { "\($0.1)1" }.replacing(/[il|]([0-9])/) { "1\($0.1)" }
        }
        return page
    }

    /// `pageText`: what Vision read on the page, when the recipe came from
    /// one — every unit and amount must be on it, so none is made up.
    public static func problems(_ recipe: GeneratedRecipe, metric: Bool, pageText: String? = nil) -> [String] {
        var out: [String] = []
        if let pageText {
            // Raw and with Vision's misreads put right: "6oml" is 60 ml, but "1.2l" must stay 1.2 l.
            let page = IngredientRules.normaliseFractions(pageText).lowercased() + "\n" + lookup(pageText)
            let words = Set(page.split(whereSeparator: { !$0.isLetter }).map(String.init))
            if let bad = recipe.ingredients.first(where: { !$0.unit.isEmpty && !words.contains($0.unit.lowercased()) && !page.contains($0.amount + $0.unit.lowercased()) }) {
                out.append("“\(bad.amount) \(bad.unit) \(bad.ingredientName)”: the unit isn’t on the page")
            }
            if let bad = recipe.ingredients.first(where: { i in
                i.amount.split(whereSeparator: { !$0.isNumber }).contains { !page.contains($0) }
            }) {
                out.append("“\(bad.amount) \(bad.ingredientName)”: the amount isn’t on the page")
            }
        }
        if recipe.title.trimmingCharacters(in: .whitespaces).isEmpty { out.append("no title") }
        if recipe.ingredients.isEmpty { out.append("no ingredients") }
        if recipe.steps.isEmpty { out.append("no steps") }
        if recipe.ingredients.contains(where: { $0.ingredientName.trimmingCharacters(in: .whitespaces).isEmpty }) {
            out.append("an ingredient with no name")
        }
        if recipe.steps.contains(where: { $0.instruction.trimmingCharacters(in: .whitespaces).isEmpty }) {
            out.append("an empty step")
        }
        if let bad = recipe.ingredients.first(where: { !IngredientChecks.isAmount($0.amount) }) {
            out.append("“\(bad.amount)” isn’t an amount")
        }
        if let bad = recipe.steps.first(where: { !$0.durationMinutes.isEmpty && Int($0.durationMinutes) == nil }) {
            out.append("“\(bad.durationMinutes)” isn’t a number of minutes")
        }
        if let bad = recipe.ingredients.first(where: { $0.unit.contains(/[0-9]/) }) {
            out.append("“\(bad.unit)” isn’t a unit")
        }
        if let bad = recipe.ingredients.first(where: { i in
            !i.unit.isEmpty && i.ingredientName.lowercased().split(separator: " ").contains { $0 == i.unit.lowercased() }
        }) {
            out.append("“\(bad.unit) \(bad.ingredientName)”: the unit repeats the name")
        }
        if !difficulties.contains(recipe.difficulty) { out.append("difficulty “\(recipe.difficulty)”") }
        if let bad = recipe.mealTypes.first(where: { !mealTypes.contains($0) }) { out.append("meal type “\(bad)”") }
        if Double(recipe.servings.replacingOccurrences(of: ",", with: ".")) == nil { out.append("servings “\(recipe.servings)”") }
        if metric, let bad = recipe.ingredients.first(where: { imperialUnits.contains($0.unit.lowercased()) }) {
            out.append("“\(bad.unit)” in a metric household")
        }
        return out
    }
}

public enum IngredientChecks {
    /// "", "2", "2.5", "1/2", "1 1/2", "1-2", "0.5-1".
    public static func isAmount(_ s: String) -> Bool {
        s.isEmpty || s.wholeMatch(of: /[0-9]+(?:\.[0-9]+)?(?:\s+[0-9]+\/[0-9]+)?|[0-9]+\/[0-9]+|[0-9]+(?:\.[0-9]+)?\s*-\s*[0-9]+(?:\.[0-9]+)?/) != nil
    }

    /// Words that stand for a number: "a handful", "half a cucumber", "pinch of salt" (one pinch).
    static let numberWords: Set<String> = ["a", "an", "one", "two", "three", "four", "five", "six", "half", "couple",
                                           "pinch", "dash", "splash", "knob", "drizzle", "handful", "juice", "zest"]

    /// The parts of one line, against the line itself: everything named must
    /// be in it, so nothing is invented.
    public static func problems(_ parts: GeneratedRecipe.Ingredient, line: String) -> [String] {
        let lower = IngredientRules.normaliseFractions(line).lowercased()
        let lineWords = Set(lower.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init))
        var out: [String] = []
        let name = parts.ingredientName.lowercased()
        if name.trimmingCharacters(in: .whitespaces).isEmpty { out.append("no name") }
        let invented = name.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)
            .filter { $0.count > 2 && !lineWords.contains($0) && !lineWords.contains($0 + "s") && !lineWords.contains(String($0.dropLast())) }
        if !invented.isEmpty { out.append("“\(invented.joined(separator: " "))” isn’t in the line") }
        if !isAmount(parts.amount) { out.append("“\(parts.amount)” isn’t an amount") }
        let digits = parts.amount.split(whereSeparator: { !$0.isNumber }).map(String.init)
        if !digits.isEmpty, !digits.allSatisfy({ lower.contains($0) }), lineWords.isDisjoint(with: numberWords) {
            out.append("the amount “\(parts.amount)” isn’t in the line")
        }
        if !parts.unit.isEmpty, !lower.contains(parts.unit.lowercased()) { out.append("the unit “\(parts.unit)” isn’t in the line") }
        return out
    }
}
