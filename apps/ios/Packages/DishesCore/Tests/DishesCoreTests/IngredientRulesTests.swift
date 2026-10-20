// IngredientRules must read every line of fixtures/ingredient-lines.json
// exactly as the web's rules do (its `rules` answers, which
// scripts/check-ai-context.ts checks the web against) — and the wire types
// must read the recipe fixture the server's schema accepts.

import Foundation
import Testing
@testable import DishesCore

struct IngredientLineFixture: Decodable, Sendable {
    struct Parts: Decodable, Sendable, Equatable {
        var amount: String
        var unit: String
        var name: String
        var preparation: String
        var isOptional: Bool?
    }

    var line: String
    var expected: Parts
    var rules: Parts?

    static func load() throws -> [IngredientLineFixture] {
        struct File: Decodable { var lines: [IngredientLineFixture] }
        return try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("ingredient-lines.json"))).lines
    }
}

/// fixtures/<name>, from this file's place in the repo.
func fixtureURL(_ name: String) -> URL {
    URL(filePath: #filePath).deletingLastPathComponent()
        .appending(path: "../../../../../../fixtures/\(name)").standardized
}

@Suite struct IngredientRulesTests {
    @Test(arguments: try IngredientLineFixture.load())
    func readsTheLineAsTheWebDoes(_ fixture: IngredientLineFixture) {
        let parsed = IngredientRules.parse(fixture.line)
        let parts = parsed.map {
            IngredientLineFixture.Parts(amount: $0.amount, unit: $0.unit, name: $0.ingredientName,
                                        preparation: $0.preparation, isOptional: $0.isOptional)
        }
        #expect(parts == fixture.rules, "“\(fixture.line)”")
    }

    @Test func headingsBecomeGroups() {
        let rows = IngredientRules.parseLines(["For the sauce:", "2 tbsp soy sauce", "Garnish:", "1 lime, cut into wedges"])
        #expect(rows.map(\.groupLabel) == ["For the sauce", "Garnish"])
        #expect(rows.map(\.ingredientName) == ["soy sauce", "lime"])
    }

    @Test func unsureLinesAreTheOnesTheRulesMisread() {
        #expect(IngredientRules.isUnsure("2 tbsp finely chopped parsley", IngredientRules.parse("2 tbsp finely chopped parsley")))
        #expect(IngredientRules.isUnsure("juice of 1 lemon", IngredientRules.parse("juice of 1 lemon")))
        #expect(IngredientRules.isUnsure("a handful of rocket", IngredientRules.parse("a handful of rocket")))
        #expect(!IngredientRules.isUnsure("2 onions, finely chopped", IngredientRules.parse("2 onions, finely chopped")))
        #expect(!IngredientRules.isUnsure("500g beef mince", IngredientRules.parse("500g beef mince")))
    }

    @Test func theRecipeFixtureRoundTrips() throws {
        let data = try Data(contentsOf: fixtureURL("wire/generated-recipe.json"))
        let recipe = try JSONDecoder().decode(GeneratedRecipe.self, from: data)
        #expect(recipe.ingredients.count == 3)
        #expect(recipe.ingredients[2].isOptional)
        #expect(recipe.collectionId == .some(nil), "null is kept: file it nowhere")
        let again = try JSONSerialization.jsonObject(with: JSONEncoder().encode(recipe)) as! [String: Any]
        let original = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        #expect(Set(again.keys) == Set(original.keys), "the keys the server's strict schema expects, no more")
    }
}

@Suite struct SplitQuantityTests {
    @Test(arguments: [
        ("250g", "250", "g"), ("2 tbsp", "2", "tbsp"), ("4", "4", ""), ("6 rashers", "6", "rashers"),
        ("1½ tsp", "1 1/2", "tsp"), ("1-2", "1-2", ""), ("3 to 4 tbsp", "3-4", "tbsp"), ("1.2 litres", "1.2", "litres"),
        ("", "", ""), ("a handful", "", ""), ("2 large", "2", "large"),
    ])
    func splits(_ raw: String, _ amount: String, _ unit: String) {
        let got = IngredientRules.splitQuantity(raw)
        #expect(got.amount == amount && got.unit == unit, "“\(raw)” → \(got)")
    }
}
