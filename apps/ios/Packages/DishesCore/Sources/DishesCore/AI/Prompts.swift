// The on-device prompts: Swift copies of the server's, so a recipe read on
// the iPad follows the same rules as one read by the server (TODO_MOBILE.md,
// Phase D2). Each says which server function it copies — change one, change
// the other (the server's side points back here).
//
// The JSON schema text the server spells out in its prompts isn't copied:
// guided generation (`@Generable`) gives the on-device model the shape itself.

import Foundation

public enum Prompts {
    /// Copy of `buildSystemAddendum` (apps/web/lib/ai/recipe-generation.ts):
    /// the household's measurement system, default prompt and equipment.
    public static func systemAddendum(_ context: AIContext?, measurements: Bool = true) -> String {
        guard let context else { return "" }
        var parts: [String] = []
        if measurements, context.measurementSystem == "metric" {
            parts.append("Always use metric measurements only: grams (g), millilitres (ml), kilograms (kg), litres (l). Never use cups, tablespoons, teaspoons, fluid ounces, pounds, or any other imperial or US customary units.")
        }
        if let prompt = context.defaultPrompt?.trimmingCharacters(in: .whitespacesAndNewlines), !prompt.isEmpty {
            parts.append(prompt)
        }
        if let equipment = context.kitchenEquipment?.trimmingCharacters(in: .whitespacesAndNewlines), !equipment.isEmpty {
            parts.append("Available kitchen equipment: \(equipment). Size recipes to fit this equipment where relevant.")
        }
        return parts.isEmpty ? "" : "\n\nAdditional requirements: " + parts.joined(separator: " ")
    }

    /// Copy of `analyzeRecipePhoto`'s system prompt (apps/web/app/actions/ai.ts),
    /// less its JSON schema. The device reads the page's text with Vision
    /// first, so the prompt says the text comes with it.
    ///
    /// One difference on purpose: no "always use metric". The on-device model
    /// took it as an order to put metric units on everything — "4 ripe
    /// tomatoes" came back as "4 kg tomato". Reading a page is transcription;
    /// a metric household's recipe in cups or ounces fails RecipeChecks and
    /// goes to the server, which converts it.
    public static func readRecipe(_ context: AIContext?) -> String {
        """
        You are a recipe digitisation assistant. Extract the complete recipe from the provided image of a cookbook \
        page, recipe card or screenshot. The text recognised on the page is given with it, in reading order; use it \
        for the exact wording, amounts and units, and the image for the layout (which lines are ingredients, which \
        are method, and section headings such as "For the sauce").
        Keep every ingredient and every step, in order. Put the amount and the unit in their own fields and any \
        preparation ("finely chopped") in its own field, not in the name. A step's duration is in whole minutes, \
        only when the step says how long. Use the same group label for an ingredient section and the matching \
        method section.
        Copy each ingredient's quantity exactly as printed in front of it — "250g", "2 tbsp", "1-2", "6" — and \
        never add a measure the page doesn't give. "6 shallots, halved" is quantity "6", name "shallots", \
        preparation "halved"; "1 cinnamon stick" is quantity "1", name "cinnamon stick".
        If a value is not present on the page leave it empty. Never invent information not visible on the page.
        """ + systemAddendum(context, measurements: false)
    }

    /// No server copy: the server reads pasted lines with rules alone
    /// (`splitIngredientsText`). These instructions take over where the rules
    /// misread a line (IngredientRules.isUnsure).
    public static let readIngredientLine = """
        You split one line of a recipe's ingredient list into its parts, exactly as written. \
        amount: the number only — "2", "1/2", "1 1/2", "1-2" — or empty. Words become numbers: "a" or "an" is "1", "half" is "1/2". \
        unit: the measure, as written — "g", "ml", "tbsp", "tsp", "cups", "pinch", "handful", "bunch", "rashers" — or empty when the amount counts the ingredient itself ("2 onions"). \
        name: the ingredient only, keeping words that say which one ("flat-leaf parsley", "large red onion", "400g tins chickpeas"). \
        preparation: what is done to it — "finely chopped", "softened", "skin on" — or empty. Words that say what is sold stay in the name: "chopped tomatoes" from a tin, "ground cumin", "smoked paprika".
        Never add anything that isn't in the line, and leave out notes such as "(about 600g)" or "(optional)".
        Examples (none of them are in the evaluation set — keep it that way, or its score means nothing):
        "1 tbsp roughly chopped coriander" → amount "1", unit "tbsp", name "coriander", preparation "roughly chopped"
        "juice of 2 limes" → amount "2", unit "", name "limes", preparation "juiced"
        "zest of 1 lemon" → amount "1", unit "", name "lemon", preparation "zested"
        "pinch of salt" → amount "1", unit "pinch", name "salt", preparation ""
        "half an onion, sliced" → amount "1/2", unit "", name "onion", preparation "sliced"
        "100 g grated parmesan" → amount "100", unit "g", name "parmesan", preparation "grated"
        """

    /// Copy of `collectionSuggestionFor`'s system prompt (apps/web/app/actions/ai.ts),
    /// less its JSON format: the schema allows only the listed names or none.
    public static let fileRecipe = """
        You file new recipes into a family's existing recipe collections. Choose a collection ONLY when the recipe \
        clearly and obviously belongs in it, judging by the collection's name and description. If no collection is a \
        clear fit, answer “\(CollectionPicker.none)” — leaving a recipe uncategorised is far better than filing it in \
        the wrong place.
        """

    /// Copy of the same function's user message.
    public static func fileRecipeQuestion(_ recipe: GeneratedRecipe, collections: [AIContext.Collection]) -> String {
        let list = collections.map { c in
            "- \(c.name)" + (c.description.map { $0.trimmingCharacters(in: .whitespaces) }.flatMap { $0.isEmpty ? nil : ": \($0)" } ?? "")
        }.joined(separator: "\n")
        let lines = [
            "Title: \(recipe.title)",
            recipe.description.isEmpty ? nil : "Description: \(recipe.description)",
            recipe.cuisine.isEmpty ? nil : "Cuisine: \(recipe.cuisine)",
            recipe.mealTypes.isEmpty ? nil : "Meal types: \(recipe.mealTypes.joined(separator: ", "))",
            recipe.tags.isEmpty ? nil : "Tags: \(recipe.tags.joined(separator: ", "))",
        ].compactMap { $0 }.joined(separator: "\n")
        return "Existing collections:\n\(list)\n\nNew recipe:\n\(lines)\n\nWhich collection does this recipe belong in?"
    }
}
